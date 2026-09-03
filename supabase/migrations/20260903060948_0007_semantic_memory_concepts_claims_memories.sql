-- =========================================================================
-- 0007 — Memória semântica: conceitos, afirmações, evidências e memórias
-- Aprendizagem controlada: nada vira verdade permanente sem confirmação.
-- =========================================================================

create table if not exists public.concepts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  label        text not null,
  slug         text not null,
  definition   text,
  aliases      text[] not null default '{}',
  occurrences  int not null default 0,
  status       text not null default 'candidate'
               check (status in ('candidate', 'confirmed', 'active', 'corrected',
                                 'archived', 'excluded')),
  confidence   numeric(4, 3),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null,
  unique (workspace_id, slug)
);
create index if not exists concepts_label_trgm_idx on public.concepts using gin (label extensions.gin_trgm_ops);
create index if not exists concepts_ws_status_idx on public.concepts (workspace_id, status);

create table if not exists public.source_concepts (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_id    uuid not null references public.sources (id) on delete cascade,
  concept_id   uuid not null references public.concepts (id) on delete cascade,
  section_id   uuid references public.source_sections (id) on delete set null,
  weight       numeric(4, 3) not null default 0.5,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null,
  primary key (source_id, concept_id)
);
create index if not exists source_concepts_concept_idx on public.source_concepts (concept_id);

create table if not exists public.claims (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  source_id         uuid references public.sources (id) on delete cascade,
  source_version_id uuid references public.source_versions (id) on delete cascade,
  text              text not null,
  normalized_text   text,
  kind              text not null default 'assertion'
                    check (kind in ('assertion', 'definition', 'principle',
                                    'observation', 'prescription', 'question')),
  polarity          text not null default 'affirmative'
                    check (polarity in ('affirmative', 'negative', 'conditional')),
  confidence        numeric(4, 3) not null default 0.5,
  authority_level   int check (authority_level between 1 and 5),
  status            text not null default 'candidate'
                    check (status in ('candidate', 'confirmed', 'active', 'corrected',
                                      'archived', 'excluded')),
  requires_review   boolean not null default false,
  valid_from        date,
  valid_until       date,
  supersedes_id     uuid references public.claims (id) on delete set null,
  superseded_by_id  uuid references public.claims (id) on delete set null,
  model             text,
  prompt_version_id uuid,
  tsv               tsvector generated always as
                    (to_tsvector('public.pt_unaccent'::regconfig, coalesce(text, ''))) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null
);
create index if not exists claims_tsv_idx on public.claims using gin (tsv);
create index if not exists claims_source_idx on public.claims (source_id);
create index if not exists claims_ws_status_idx on public.claims (workspace_id, status);

create table if not exists public.claim_evidence (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  claim_id     uuid not null references public.claims (id) on delete cascade,
  chunk_id     uuid references public.source_chunks (id) on delete cascade,
  section_id   uuid references public.source_sections (id) on delete set null,
  source_id    uuid references public.sources (id) on delete cascade,
  quote        text,
  char_start   int,
  char_end     int,
  page_start   int,
  page_end     int,
  strength     numeric(4, 3) not null default 0.5,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null
);
create index if not exists claim_evidence_claim_idx on public.claim_evidence (claim_id);
create index if not exists claim_evidence_chunk_idx on public.claim_evidence (chunk_id);

create table if not exists public.claim_relations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  from_claim_id uuid not null references public.claims (id) on delete cascade,
  to_claim_id   uuid not null references public.claims (id) on delete cascade,
  relation      text not null
                check (relation in ('supports', 'complements', 'contradicts',
                                    'qualifies', 'supersedes', 'restates')),
  confidence    numeric(4, 3) not null default 0.5,
  rationale     text,
  status        text not null default 'candidate'
                check (status in ('candidate', 'confirmed', 'active', 'corrected',
                                  'archived', 'excluded')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,
  unique (from_claim_id, to_claim_id, relation)
);

create table if not exists public.memories (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  layer             text not null
                    check (layer in ('documental', 'semantic', 'episodic', 'authorial',
                                     'style', 'value', 'feedback')),
  title             text,
  content           text not null,
  summary           text,
  origin            text not null default 'inferred'
                    check (origin in ('stated', 'inferred', 'imported', 'derived')),
  status            text not null default 'candidate'
                    check (status in ('candidate', 'confirmed', 'active', 'corrected',
                                      'archived', 'excluded')),
  sensitivity       text not null default 'normal'
                    check (sensitivity in ('normal', 'sensitive')),
  requires_review   boolean not null default true,
  confidence        numeric(4, 3) not null default 0.5,
  authority_level   int check (authority_level between 1 and 5),
  valid_from        date,
  valid_until       date,
  supersedes_id     uuid references public.memories (id) on delete set null,
  superseded_by_id  uuid references public.memories (id) on delete set null,
  source_id         uuid references public.sources (id) on delete set null,
  claim_id          uuid references public.claims (id) on delete set null,
  episode_id        uuid,
  reflection_id     uuid,
  model             text,
  prompt_version_id uuid,
  metadata          jsonb not null default '{}'::jsonb,
  reviewed_by       uuid references auth.users (id) on delete set null,
  reviewed_at       timestamptz,
  tsv               tsvector generated always as
                    (to_tsvector('public.pt_unaccent'::regconfig,
                       coalesce(title, '') || ' ' || coalesce(content, ''))) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null
);
create index if not exists memories_tsv_idx on public.memories using gin (tsv);
create index if not exists memories_ws_layer_status_idx on public.memories (workspace_id, layer, status);

create table if not exists public.memory_relations (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  from_memory_id uuid not null references public.memories (id) on delete cascade,
  to_memory_id   uuid not null references public.memories (id) on delete cascade,
  relation       text not null
                 check (relation in ('supports', 'complements', 'contradicts',
                                     'qualifies', 'supersedes', 'about')),
  confidence     numeric(4, 3) not null default 0.5,
  rationale      text,
  status         text not null default 'candidate'
                 check (status in ('candidate', 'confirmed', 'active', 'corrected',
                                   'archived', 'excluded')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id) on delete set null,
  unique (from_memory_id, to_memory_id, relation)
);

create trigger set_updated_at before update on public.concepts
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.claims
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.claim_relations
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.memories
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.memory_relations
  for each row execute function public.tg_set_updated_at();

select public.apply_workspace_rls(t) from unnest(array[
  'concepts', 'source_concepts', 'claims', 'claim_evidence', 'claim_relations',
  'memories', 'memory_relations'
]) as t;

select public.assert_rls_enabled();
