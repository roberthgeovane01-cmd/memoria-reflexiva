-- =========================================================================
-- 0011 — Funções de busca híbrida/hierárquica, fila de jobs e enforcement
-- Todas as funções são SECURITY INVOKER: a RLS continua valendo.
-- =========================================================================

-- tsv de resumos é mantido por trigger (array_to_string não é IMMUTABLE,
-- então não pode entrar numa coluna gerada).
alter table public.source_summaries add column if not exists tsv tsvector;

create or replace function public.tg_source_summaries_tsv()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  new.tsv := to_tsvector(
    'public.pt_unaccent'::regconfig,
    coalesce(new.summary, '') || ' ' ||
    coalesce(array_to_string(new.key_points, ' '), '') || ' ' ||
    coalesce(array_to_string(new.themes, ' '), '')
  );
  return new;
end;
$$;

drop trigger if exists source_summaries_tsv on public.source_summaries;
create trigger source_summaries_tsv
  before insert or update of summary, key_points, themes
  on public.source_summaries
  for each row execute function public.tg_source_summaries_tsv();

create index if not exists source_summaries_tsv_idx on public.source_summaries using gin (tsv);
create index if not exists source_summaries_scope_idx
  on public.source_summaries (workspace_id, scope, status);

-- --- Busca vetorial genérica (qualquer nível da hierarquia) ---------------
create or replace function public.mr_search_vector(
  p_workspace_id       uuid,
  p_embedding          extensions.vector(1536),
  p_embedding_space_id uuid,
  p_owner_kind         text,
  p_limit              int default 30,
  p_source_ids         uuid[] default null
)
returns table (owner_id uuid, source_id uuid, distance double precision)
language sql stable set search_path = public, extensions, pg_temp as $$
  select e.owner_id, e.source_id, (e.embedding <=> p_embedding)::double precision
  from public.embeddings e
  where e.workspace_id = p_workspace_id
    and e.embedding_space_id = p_embedding_space_id
    and e.owner_kind = p_owner_kind
    and (p_source_ids is null or e.source_id = any (p_source_ids))
  order by e.embedding <=> p_embedding
  limit greatest(p_limit, 1);
$$;

-- --- Busca textual (português, sem acentos no índice) --------------------
create or replace function public.mr_search_chunks_fulltext(
  p_workspace_id uuid, p_query text, p_limit int default 30, p_source_ids uuid[] default null)
returns table (owner_id uuid, source_id uuid, score double precision)
language sql stable set search_path = public, extensions, pg_temp as $$
  select c.id, c.source_id, ts_rank_cd(c.tsv, q)::double precision
  from public.source_chunks c,
       websearch_to_tsquery('public.pt_unaccent'::regconfig, coalesce(p_query, '')) q
  where c.workspace_id = p_workspace_id
    and c.status = 'active'
    and c.tsv @@ q
    and (p_source_ids is null or c.source_id = any (p_source_ids))
  order by 3 desc
  limit greatest(p_limit, 1);
$$;

create or replace function public.mr_search_summaries_fulltext(
  p_workspace_id uuid, p_query text, p_scope text, p_limit int default 30,
  p_source_ids uuid[] default null)
returns table (owner_id uuid, source_id uuid, score double precision)
language sql stable set search_path = public, extensions, pg_temp as $$
  select s.id, s.source_id, ts_rank_cd(s.tsv, q)::double precision
  from public.source_summaries s,
       websearch_to_tsquery('public.pt_unaccent'::regconfig, coalesce(p_query, '')) q
  where s.workspace_id = p_workspace_id
    and s.status = 'active'
    and s.scope = p_scope
    and s.tsv @@ q
    and (p_source_ids is null or s.source_id = any (p_source_ids))
  order by 3 desc
  limit greatest(p_limit, 1);
$$;

create or replace function public.mr_search_claims_fulltext(
  p_workspace_id uuid, p_query text, p_limit int default 30, p_source_ids uuid[] default null)
returns table (owner_id uuid, source_id uuid, score double precision)
language sql stable set search_path = public, extensions, pg_temp as $$
  select cl.id, cl.source_id, ts_rank_cd(cl.tsv, q)::double precision
  from public.claims cl,
       websearch_to_tsquery('public.pt_unaccent'::regconfig, coalesce(p_query, '')) q
  where cl.workspace_id = p_workspace_id
    and cl.status in ('candidate', 'confirmed', 'active')
    and cl.tsv @@ q
    and (p_source_ids is null or cl.source_id = any (p_source_ids))
  order by 3 desc
  limit greatest(p_limit, 1);
$$;

create or replace function public.mr_search_episodes_fulltext(
  p_workspace_id uuid, p_query text, p_limit int default 20)
returns table (owner_id uuid, source_id uuid, score double precision)
language sql stable set search_path = public, extensions, pg_temp as $$
  select ep.id, null::uuid, ts_rank_cd(ep.tsv, q)::double precision
  from public.episodes ep,
       websearch_to_tsquery('public.pt_unaccent'::regconfig, coalesce(p_query, '')) q
  where ep.workspace_id = p_workspace_id
    and ep.status in ('candidate', 'active')
    and ep.tsv @@ q
  order by 3 desc
  limit greatest(p_limit, 1);
$$;

-- --- Fusão Reciprocal Rank Fusion (vetorial + textual) -------------------
create or replace function public.mr_hybrid_search(
  p_workspace_id       uuid,
  p_query              text,
  p_embedding          extensions.vector(1536),
  p_embedding_space_id uuid,
  p_owner_kind         text,
  p_limit              int default 30,
  p_candidates         int default 80,
  p_source_ids         uuid[] default null,
  p_rrf_k              int default 60
)
returns table (
  owner_id uuid, source_id uuid, vector_score double precision,
  fulltext_score double precision, fusion_score double precision,
  vector_rank int, fulltext_rank int
)
language plpgsql stable set search_path = public, extensions, pg_temp as $$
begin
  return query
  with vec as (
    select v.owner_id, v.source_id, (1.0 - v.distance) as score,
           row_number() over (order by v.distance asc)::int as rnk
    from public.mr_search_vector(p_workspace_id, p_embedding, p_embedding_space_id,
                                 p_owner_kind, p_candidates, p_source_ids) v
    where p_embedding is not null
  ),
  txt as (
    select t.owner_id, t.source_id, t.score,
           row_number() over (order by t.score desc)::int as rnk
    from (
      select * from public.mr_search_chunks_fulltext(p_workspace_id, p_query, p_candidates, p_source_ids)
        where p_owner_kind = 'chunk'
      union all
      select * from public.mr_search_summaries_fulltext(p_workspace_id, p_query, 'global', p_candidates, p_source_ids)
        where p_owner_kind = 'source_summary'
      union all
      select * from public.mr_search_summaries_fulltext(p_workspace_id, p_query, 'section', p_candidates, p_source_ids)
        where p_owner_kind = 'section_summary'
      union all
      select * from public.mr_search_claims_fulltext(p_workspace_id, p_query, p_candidates, p_source_ids)
        where p_owner_kind = 'claim'
      union all
      select * from public.mr_search_episodes_fulltext(p_workspace_id, p_query, p_candidates)
        where p_owner_kind = 'episode'
    ) t
  ),
  fused as (
    select coalesce(v.owner_id, t.owner_id) as owner_id,
           coalesce(v.source_id, t.source_id) as source_id,
           v.score as vector_score,
           t.score as fulltext_score,
           coalesce(1.0 / (p_rrf_k + v.rnk), 0) + coalesce(1.0 / (p_rrf_k + t.rnk), 0) as fusion_score,
           v.rnk as vector_rank,
           t.rnk as fulltext_rank
    from vec v
    full outer join txt t on t.owner_id = v.owner_id
  )
  select f.owner_id, f.source_id, f.vector_score, f.fulltext_score,
         f.fusion_score, f.vector_rank, f.fulltext_rank
  from fused f
  order by f.fusion_score desc
  limit greatest(p_limit, 1);
end;
$$;

-- --- Vizinhança: um trecho nunca é interpretado fora de contexto ---------
create or replace function public.mr_chunk_window(p_chunk_id uuid, p_radius int default 1)
returns table (id uuid, source_id uuid, section_id uuid, sequence int, text text,
               page_start int, page_end int, is_center boolean)
language sql stable set search_path = public, extensions, pg_temp as $$
  with center as (
    select c.source_version_id as svid, c.sequence as seq
    from public.source_chunks c where c.id = p_chunk_id
  )
  select c.id, c.source_id, c.section_id, c.sequence, c.text,
         c.page_start, c.page_end, (c.id = p_chunk_id) as is_center
  from public.source_chunks c, center
  where c.source_version_id = center.svid
    and c.sequence between center.seq - greatest(p_radius, 0)
                       and center.seq + greatest(p_radius, 0)
    and c.status = 'active'
  order by c.sequence;
$$;

-- --- Fila de jobs: reivindicação atômica com SKIP LOCKED -----------------
create or replace function public.mr_claim_job(
  p_worker text, p_kinds text[] default null, p_workspace_id uuid default null)
returns setof public.processing_jobs
language plpgsql volatile set search_path = public, extensions, pg_temp as $$
begin
  return query
  update public.processing_jobs j
     set status = 'processing', attempts = j.attempts + 1, locked_at = now(),
         locked_by = p_worker, started_at = coalesce(j.started_at, now())
   where j.id = (
     select k.id from public.processing_jobs k
      where k.status = 'pending' and k.run_after <= now()
        and (p_kinds is null or k.kind = any (p_kinds))
        and (p_workspace_id is null or k.workspace_id = p_workspace_id)
      order by k.priority asc, k.run_after asc
      for update skip locked limit 1)
  returning j.*;
end;
$$;

create or replace function public.mr_complete_job(p_job_id uuid, p_result jsonb default '{}'::jsonb)
returns void language sql volatile set search_path = public, extensions, pg_temp as $$
  update public.processing_jobs
     set status = 'completed', result = p_result, progress = 100, finished_at = now(),
         locked_at = null, locked_by = null, error_message = null
   where id = p_job_id;
$$;

create or replace function public.mr_fail_job(p_job_id uuid, p_error text)
returns void language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare v_job public.processing_jobs;
begin
  select * into v_job from public.processing_jobs where id = p_job_id;
  if not found then return; end if;
  if v_job.attempts >= v_job.max_attempts then
    update public.processing_jobs
       set status = 'failed', error_message = p_error, finished_at = now(),
           locked_at = null, locked_by = null
     where id = p_job_id;
  else
    update public.processing_jobs
       set status = 'pending', error_message = p_error,
           run_after = now() + (interval '20 seconds' * power(3, v_job.attempts)),
           locked_at = null, locked_by = null
     where id = p_job_id;
  end if;
end;
$$;

-- --- REGRA ABSOLUTA: só existe voz para versão aprovada -------------------
create or replace function public.tg_enforce_tts_requires_approval()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_status text; v_hash text;
begin
  select rv.status, rv.text_hash into v_status, v_hash
  from public.reflection_versions rv where rv.id = new.reflection_version_id;
  if v_status is distinct from 'approved' then
    raise exception 'TTS negado: a versao da reflexao nao esta aprovada (status atual: %).',
      coalesce(v_status, 'inexistente') using errcode = 'check_violation';
  end if;
  if new.text_hash is distinct from v_hash then
    raise exception 'TTS negado: hash do texto nao corresponde a versao aprovada.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_tts_requires_approval on public.reflection_audio_versions;
create trigger enforce_tts_requires_approval
  before insert or update of reflection_version_id, text_hash
  on public.reflection_audio_versions
  for each row execute function public.tg_enforce_tts_requires_approval();

-- Uma versão aprovada é imutável no texto.
create or replace function public.tg_freeze_approved_version()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'approved' and (new.text is distinct from old.text
      or new.text_hash is distinct from old.text_hash) then
    raise exception 'Versao aprovada e imutavel. Crie uma nova versao.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists freeze_approved_version on public.reflection_versions;
create trigger freeze_approved_version
  before update on public.reflection_versions
  for each row execute function public.tg_freeze_approved_version();
