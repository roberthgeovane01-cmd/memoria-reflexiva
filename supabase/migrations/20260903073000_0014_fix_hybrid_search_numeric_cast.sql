-- =========================================================================
-- 0014 — Correção encontrada pela prova do cérebro
--
-- Literais como 1.0 são `numeric` no PostgreSQL. A soma do RRF e o cálculo
-- de similaridade estavam produzindo `numeric` numa função que declara
-- `double precision`, o que fazia toda chamada a mr_hybrid_search falhar com
-- "structure of query does not match function result type".
-- =========================================================================

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
  owner_id       uuid,
  source_id      uuid,
  vector_score   double precision,
  fulltext_score double precision,
  fusion_score   double precision,
  vector_rank    int,
  fulltext_rank  int
)
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
begin
  return query
  with vec as (
    select v.owner_id, v.source_id,
           (1.0::double precision - v.distance) as score,
           row_number() over (order by v.distance asc)::int as rnk
    from public.mr_search_vector(
           p_workspace_id, p_embedding, p_embedding_space_id,
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
           (coalesce(1.0 / (p_rrf_k + v.rnk), 0) + coalesce(1.0 / (p_rrf_k + t.rnk), 0))::double precision
             as fusion_score,
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
