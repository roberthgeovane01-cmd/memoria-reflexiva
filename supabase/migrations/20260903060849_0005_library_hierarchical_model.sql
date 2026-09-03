-- =========================================================================
-- 0005 — Biblioteca hierárquica
-- SOURCE -> VERSION -> SUMMARY GLOBAL -> SECTIONS -> SECTION SUMMARIES -> CHUNKS
-- =========================================================================

create table if not exists public.sources (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  title              text not null,
  subtitle           text,
  authors            text[] not null default '{}',
  kind               text not null default 'document'
                     check (kind in ('book', 'article', 'document', 'authored_text',
                                     'imported_reflection', 'note', 'transcript', 'other')),
  category           text,
  language           text not null default 'pt-BR',
  publisher          text,
  published_year     int,
  -- 5 cânone/princípio aprovado · 4 livro ou texto autoral final
  -- 3 reflexão aprovada · 2 anotação · 1 rascunho
  authority_level    int not null default 3 check (authority_level between 1 and 5),
  origin             text not null default 'upload'
                     check (origin in ('upload', 'authored', 'approved_reflection', 'episode', 'import')),
  is_active          boolean not null default true,
  status             text not null default 'draft'
                     check (status in ('draft', 'uploaded', 'processing', 'ready',
                                       'ocr_required', 'failed', 'archived')),
  current_version_id uuid,
  description        text,
  valid_from         date,
  valid_until        date,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users (id) on delete set null
);
create index if not exists sources_ws_status_idx on public.sources (workspace_id, status);
create index if not exists sources_ws_active_idx on public.sources (workspace_id, is_active, authority_level desc);
create index if not exists sources_title_trgm_idx on public.sources using gin (title extensions.gin_trgm_ops);

create table if not exists public.source_versions (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  source_id          uuid not null references public.sources (id) on delete cascade,
  version_number     int not null default 1,
  storage_bucket     text not null default 'library-originals',
  storage_path       text,
  original_filename  text,
  mime_type          text,
  byte_size          bigint,
  sha256             text,
  extraction_status  text not null default 'pending'
                     check (extraction_status in ('pending', 'extracting', 'extracted',
                                                  'ocr_required', 'ocr_processing',
                                                  'ocr_low_confidence', 'failed')),
  extraction_engine  text,
  extraction_quality numeric(4, 3),
  extraction_notes   text,
  page_count         int,
  char_count         int,
  word_count         int,
  raw_text           text,
  normalized_text    text,
  structure_status   text not null default 'pending'
                     check (structure_status in ('pending', 'detected', 'flat', 'failed')),
  status             text not null default 'active'
                     check (status in ('active', 'superseded', 'failed')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users (id) on delete set null,
  unique (source_id, version_number)
);
create index if not exists source_versions_source_idx on public.source_versions (source_id, version_number desc);
create unique index if not exists source_versions_ws_sha_idx
  on public.source_versions (workspace_id, sha256) where sha256 is not null;

alter table public.sources
  add constraint sources_current_version_fk
  foreign key (current_version_id) references public.source_versions (id) on delete set null;

create table if not exists public.source_sections (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  source_id         uuid not null references public.sources (id) on delete cascade,
  source_version_id uuid not null references public.source_versions (id) on delete cascade,
  parent_section_id uuid references public.source_sections (id) on delete cascade,
  level             int not null default 1,
  sequence          int not null,
  title             text,
  heading_path      text[] not null default '{}',
  char_start        int,
  char_end          int,
  page_start        int,
  page_end          int,
  token_count       int,
  status            text not null default 'active' check (status in ('active', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null,
  unique (source_version_id, sequence)
);
create index if not exists source_sections_version_idx on public.source_sections (source_version_id, sequence);
create index if not exists source_sections_parent_idx on public.source_sections (parent_section_id);

create table if not exists public.source_summaries (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  source_id         uuid not null references public.sources (id) on delete cascade,
  source_version_id uuid not null references public.source_versions (id) on delete cascade,
  section_id        uuid references public.source_sections (id) on delete cascade,
  scope             text not null check (scope in ('global', 'section')),
  summary           text not null,
  key_points        text[] not null default '{}',
  themes            text[] not null default '{}',
  model             text,
  prompt_version_id uuid,
  status            text not null default 'active'
                    check (status in ('active', 'stale', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null
);
create unique index if not exists source_summaries_global_uidx
  on public.source_summaries (source_version_id) where scope = 'global' and status = 'active';
create unique index if not exists source_summaries_section_uidx
  on public.source_summaries (section_id) where scope = 'section' and status = 'active';

create table if not exists public.source_chunks (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  source_id         uuid not null references public.sources (id) on delete cascade,
  source_version_id uuid not null references public.source_versions (id) on delete cascade,
  section_id        uuid references public.source_sections (id) on delete set null,
  sequence          int not null,
  text              text not null,
  heading_path      text[] not null default '{}',
  char_start        int,
  char_end          int,
  page_start        int,
  page_end          int,
  token_count       int not null default 0,
  hash              text not null,
  status            text not null default 'active' check (status in ('active', 'archived')),
  tsv               tsvector generated always as
                    (to_tsvector('public.pt_unaccent'::regconfig, coalesce(text, ''))) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null,
  unique (source_version_id, sequence)
);
create index if not exists source_chunks_tsv_idx on public.source_chunks using gin (tsv);
create index if not exists source_chunks_source_idx on public.source_chunks (source_id, sequence);
create index if not exists source_chunks_section_idx on public.source_chunks (section_id, sequence);
create index if not exists source_chunks_ws_idx on public.source_chunks (workspace_id, status);

create table if not exists public.tags (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null,
  slug         text not null,
  kind         text not null default 'topic'
               check (kind in ('topic', 'project', 'person', 'period', 'other')),
  color        text,
  status       text not null default 'active' check (status in ('active', 'archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null,
  unique (workspace_id, slug)
);

create table if not exists public.source_tags (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_id    uuid not null references public.sources (id) on delete cascade,
  tag_id       uuid not null references public.tags (id) on delete cascade,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null,
  primary key (source_id, tag_id)
);
create index if not exists source_tags_tag_idx on public.source_tags (tag_id);

create trigger set_updated_at before update on public.sources
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.source_versions
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.source_sections
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.source_summaries
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.source_chunks
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.tags
  for each row execute function public.tg_set_updated_at();

select public.apply_workspace_rls(t) from unnest(array[
  'sources', 'source_versions', 'source_sections', 'source_summaries',
  'source_chunks', 'tags', 'source_tags'
]) as t;

select public.assert_rls_enabled();
