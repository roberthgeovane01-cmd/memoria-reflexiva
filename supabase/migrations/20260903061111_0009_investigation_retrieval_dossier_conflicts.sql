-- =========================================================================
-- 0009 — Investigação: sessões de recuperação, dossiê e motor de conflitos
-- Toda investigação é persistida e auditável ponta a ponta.
-- =========================================================================

create table if not exists public.retrieval_sessions (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces (id) on delete cascade,
  reflection_session_id     uuid references public.reflection_sessions (id) on delete cascade,
  transcript_id             uuid references public.transcripts (id) on delete set null,
  input_text                text not null,
  central_question          text,
  intent                    text,
  plan                      jsonb not null default '{}'::jsonb,
  filters                   jsonb not null default '{}'::jsonb,
  embedding_space_id        uuid references public.embedding_spaces (id) on delete set null,
  planner_model             text,
  planner_prompt_version_id uuid,
  reranker                  text,
  parameters                jsonb not null default '{}'::jsonb,
  stats                     jsonb not null default '{}'::jsonb,
  status                    text not null default 'pending'
                            check (status in ('pending', 'planning', 'searching', 'ranking',
                                              'classifying', 'completed', 'failed')),
  error_message             text,
  started_at                timestamptz,
  finished_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid references auth.users (id) on delete set null
);
create index if not exists retrieval_sessions_ws_idx on public.retrieval_sessions (workspace_id, created_at desc);

create table if not exists public.retrieval_queries (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  retrieval_session_id uuid not null references public.retrieval_sessions (id) on delete cascade,
  sequence             int not null,
  text                 text not null,
  rationale            text,
  level                text not null check (level in ('global', 'section', 'evidence', 'direct')),
  strategy             text not null check (strategy in ('vector', 'fulltext', 'hybrid', 'metadata')),
  filters              jsonb not null default '{}'::jsonb,
  result_count         int not null default 0,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id) on delete set null,
  unique (retrieval_session_id, sequence)
);

-- Guarda TUDO: o que foi escolhido e o que foi descartado, com os scores.
create table if not exists public.retrieval_hits (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  retrieval_session_id uuid not null references public.retrieval_sessions (id) on delete cascade,
  retrieval_query_id   uuid references public.retrieval_queries (id) on delete cascade,
  level                text not null check (level in ('global', 'section', 'evidence', 'direct')),
  owner_kind           text not null
                       check (owner_kind in ('source_summary', 'section_summary', 'chunk',
                                             'claim', 'concept', 'episode', 'reflection')),
  owner_id             uuid not null,
  source_id            uuid references public.sources (id) on delete cascade,
  source_version_id    uuid references public.source_versions (id) on delete set null,
  section_id           uuid references public.source_sections (id) on delete set null,
  chunk_id             uuid references public.source_chunks (id) on delete set null,
  claim_id             uuid references public.claims (id) on delete set null,
  vector_score         numeric(8, 6),
  fulltext_score       numeric(8, 6),
  fusion_score         numeric(8, 6),
  rerank_score         numeric(8, 6),
  final_score          numeric(8, 6),
  rank_position        int,
  authority_level      int,
  diversity_penalty    numeric(8, 6) not null default 0,
  selected             boolean not null default false,
  discard_reason       text,
  snippet              text,
  explanation          jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id) on delete set null
);
create index if not exists retrieval_hits_session_idx
  on public.retrieval_hits (retrieval_session_id, selected, final_score desc);
create index if not exists retrieval_hits_owner_idx on public.retrieval_hits (owner_kind, owner_id);

create table if not exists public.memory_dossiers (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  retrieval_session_id  uuid not null references public.retrieval_sessions (id) on delete cascade,
  reflection_session_id uuid references public.reflection_sessions (id) on delete cascade,
  central_question      text not null,
  executive_summary     text not null,
  convergences          jsonb not null default '[]'::jsonb,
  complements           jsonb not null default '[]'::jsonb,
  tensions              jsonb not null default '[]'::jsonb,
  contradictions        jsonb not null default '[]'::jsonb,
  temporal_evolution    jsonb not null default '[]'::jsonb,
  related_episodes      jsonb not null default '[]'::jsonb,
  knowledge_gaps        jsonb not null default '[]'::jsonb,
  central_sources       jsonb not null default '[]'::jsonb,
  editorial_notes       jsonb not null default '[]'::jsonb,
  has_memory            boolean not null default false,
  coverage_score        numeric(4, 3),
  diversity_score       numeric(4, 3),
  model                 text,
  prompt_version_id     uuid,
  status                text not null default 'draft'
                        check (status in ('draft', 'ready', 'needs_conflict_review',
                                          'accepted', 'archived')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null
);
create index if not exists memory_dossiers_session_idx on public.memory_dossiers (retrieval_session_id);

-- Cada conclusão do dossiê aponta para as evidências que a sustentam.
create table if not exists public.dossier_evidence (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  dossier_id       uuid not null references public.memory_dossiers (id) on delete cascade,
  finding_key      text not null,
  finding_index    int not null default 0,
  classification   text not null
                   check (classification in ('supports', 'complements', 'contradicts',
                                             'qualifies', 'unrelated')),
  retrieval_hit_id uuid references public.retrieval_hits (id) on delete set null,
  source_id        uuid references public.sources (id) on delete set null,
  section_id       uuid references public.source_sections (id) on delete set null,
  chunk_id         uuid references public.source_chunks (id) on delete set null,
  claim_id         uuid references public.claims (id) on delete set null,
  episode_id       uuid references public.episodes (id) on delete set null,
  quote            text,
  rationale        text,
  confidence       numeric(4, 3),
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null
);
create index if not exists dossier_evidence_dossier_idx on public.dossier_evidence (dossier_id, finding_key);

create table if not exists public.conflicts (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  retrieval_session_id  uuid references public.retrieval_sessions (id) on delete cascade,
  dossier_id            uuid references public.memory_dossiers (id) on delete cascade,
  reflection_session_id uuid references public.reflection_sessions (id) on delete cascade,
  kind                  text not null
                        check (kind in ('complement', 'minor_divergence', 'factual_conflict',
                                        'interpretive_divergence', 'source_conflict')),
  severity              text not null default 'low' check (severity in ('low', 'medium', 'high')),
  blocking              boolean not null default false,
  title                 text not null,
  description           text not null,
  speech_excerpt        text,
  memory_excerpt        text,
  left_ref              jsonb not null default '{}'::jsonb,
  right_ref             jsonb not null default '{}'::jsonb,
  detector              text,
  model                 text,
  prompt_version_id     uuid,
  confidence            numeric(4, 3),
  status                text not null default 'open'
                        check (status in ('open', 'resolved', 'dismissed')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null
);
create index if not exists conflicts_session_idx on public.conflicts (reflection_session_id, status, severity);

-- A decisão é sempre humana e sempre registrada.
create table if not exists public.conflict_resolutions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  conflict_id       uuid not null references public.conflicts (id) on delete cascade,
  decision          text not null
                    check (decision in ('keep_speech', 'use_memory', 'treat_as_complement',
                                        'treat_as_evolution', 'manual_edit', 'ignore_source')),
  manual_text       text,
  ignored_source_id uuid references public.sources (id) on delete set null,
  rationale         text,
  decided_by        uuid references auth.users (id) on delete set null,
  decided_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null
);
create index if not exists conflict_resolutions_conflict_idx on public.conflict_resolutions (conflict_id);

alter table public.reflection_sessions
  add constraint reflection_sessions_retrieval_fk
  foreign key (retrieval_session_id) references public.retrieval_sessions (id) on delete set null;
alter table public.reflection_sessions
  add constraint reflection_sessions_dossier_fk
  foreign key (dossier_id) references public.memory_dossiers (id) on delete set null;

create trigger set_updated_at before update on public.retrieval_sessions
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.memory_dossiers
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.conflicts
  for each row execute function public.tg_set_updated_at();

select public.apply_workspace_rls(t) from unnest(array[
  'retrieval_sessions', 'retrieval_queries', 'retrieval_hits', 'memory_dossiers',
  'dossier_evidence', 'conflicts', 'conflict_resolutions'
]) as t;

select public.assert_rls_enabled();
