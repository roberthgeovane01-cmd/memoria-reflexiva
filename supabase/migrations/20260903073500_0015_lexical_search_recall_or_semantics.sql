-- =========================================================================
-- 0015 — Segunda correção encontrada pela prova do cérebro
--
-- `websearch_to_tsquery` liga os termos com AND. Numa consulta de seis
-- palavras, quase nada casa, e a metade lexical da busca híbrida ficava
-- praticamente inútil — exatamente o oposto do que a fusão RRF precisa.
--
-- Agora a busca textual usa OR (recall) e dá um bônus de 2x para o trecho
-- que também satisfaz a consulta estrita (precisão). ts_rank_cd já favorece
-- naturalmente quem casa mais termos e com maior proximidade entre eles.
-- =========================================================================

create or replace function public.mr_tsquery_or(p_query text)
returns tsquery
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select nullif(
    replace(
      plainto_tsquery('public.pt_unaccent'::regconfig, coalesce(p_query, ''))::text,
      ' & ', ' | '
    ),
    ''
  )::tsquery;
$$;

create or replace function public.mr_tsquery_strict(p_query text)
returns tsquery
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select websearch_to_tsquery('public.pt_unaccent'::regconfig, coalesce(p_query, ''));
$$;

create or replace function public.mr_search_chunks_fulltext(
  p_workspace_id uuid, p_query text, p_limit int default 30, p_source_ids uuid[] default null)
returns table (owner_id uuid, source_id uuid, score double precision)
language sql stable set search_path = public, extensions, pg_temp as $$
  select c.id, c.source_id,
         (ts_rank_cd(c.tsv, q.loose) *
           case when q.strict is not null and c.tsv @@ q.strict then 2.0 else 1.0 end
         )::double precision
  from public.source_chunks c,
       (select public.mr_tsquery_or(p_query) as loose,
               public.mr_tsquery_strict(p_query) as strict) q
  where c.workspace_id = p_workspace_id
    and c.status = 'active'
    and q.loose is not null
    and c.tsv @@ q.loose
    and (p_source_ids is null or c.source_id = any (p_source_ids))
  order by 3 desc
  limit greatest(p_limit, 1);
$$;

create or replace function public.mr_search_summaries_fulltext(
  p_workspace_id uuid, p_query text, p_scope text, p_limit int default 30,
  p_source_ids uuid[] default null)
returns table (owner_id uuid, source_id uuid, score double precision)
language sql stable set search_path = public, extensions, pg_temp as $$
  select s.id, s.source_id,
         (ts_rank_cd(s.tsv, q.loose) *
           case when q.strict is not null and s.tsv @@ q.strict then 2.0 else 1.0 end
         )::double precision
  from public.source_summaries s,
       (select public.mr_tsquery_or(p_query) as loose,
               public.mr_tsquery_strict(p_query) as strict) q
  where s.workspace_id = p_workspace_id
    and s.status = 'active'
    and s.scope = p_scope
    and q.loose is not null
    and s.tsv @@ q.loose
    and (p_source_ids is null or s.source_id = any (p_source_ids))
  order by 3 desc
  limit greatest(p_limit, 1);
$$;

create or replace function public.mr_search_claims_fulltext(
  p_workspace_id uuid, p_query text, p_limit int default 30, p_source_ids uuid[] default null)
returns table (owner_id uuid, source_id uuid, score double precision)
language sql stable set search_path = public, extensions, pg_temp as $$
  select cl.id, cl.source_id,
         (ts_rank_cd(cl.tsv, q.loose) *
           case when q.strict is not null and cl.tsv @@ q.strict then 2.0 else 1.0 end
         )::double precision
  from public.claims cl,
       (select public.mr_tsquery_or(p_query) as loose,
               public.mr_tsquery_strict(p_query) as strict) q
  where cl.workspace_id = p_workspace_id
    and cl.status in ('candidate', 'confirmed', 'active')
    and q.loose is not null
    and cl.tsv @@ q.loose
    and (p_source_ids is null or cl.source_id = any (p_source_ids))
  order by 3 desc
  limit greatest(p_limit, 1);
$$;

create or replace function public.mr_search_episodes_fulltext(
  p_workspace_id uuid, p_query text, p_limit int default 20)
returns table (owner_id uuid, source_id uuid, score double precision)
language sql stable set search_path = public, extensions, pg_temp as $$
  select ep.id, null::uuid,
         (ts_rank_cd(ep.tsv, q.loose) *
           case when q.strict is not null and ep.tsv @@ q.strict then 2.0 else 1.0 end
         )::double precision
  from public.episodes ep,
       (select public.mr_tsquery_or(p_query) as loose,
               public.mr_tsquery_strict(p_query) as strict) q
  where ep.workspace_id = p_workspace_id
    and ep.status in ('candidate', 'active')
    and q.loose is not null
    and ep.tsv @@ q.loose
  order by 3 desc
  limit greatest(p_limit, 1);
$$;

revoke execute on function public.mr_tsquery_or(text) from anon;
revoke execute on function public.mr_tsquery_strict(text) from anon;
