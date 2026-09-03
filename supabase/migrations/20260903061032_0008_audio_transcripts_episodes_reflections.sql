-- =========================================================================
-- 0008 — Áudio, transcrição, memória episódica e reflexões versionadas
-- =========================================================================

create table if not exists public.audio_entries (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  title             text,
  kind              text not null default 'recording' check (kind in ('recording', 'upload')),
  storage_bucket    text not null default 'audio-originals',
  storage_path      text,
  original_filename text,
  mime_type         text,
  byte_size         bigint,
  duration_seconds  numeric(10, 2),
  sha256            text,
  recorded_at       timestamptz not null default now(),
  status            text not null default 'uploaded'
                    check (status in ('uploaded', 'transcribing', 'transcribed',
                                      'failed', 'archived')),
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null
);
create index if not exists audio_entries_ws_idx on public.audio_entries (workspace_id, recorded_at desc);

-- raw_transcript e approved_transcript vivem separados. O original nunca é
-- sobrescrito pela revisão humana.
create table if not exists public.transcripts (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  audio_entry_id      uuid not null references public.audio_entries (id) on delete cascade,
  raw_transcript      text,
  approved_transcript text,
  language            text not null default 'pt-BR',
  provider            text,
  model               text,
  confidence          numeric(4, 3),
  segments            jsonb not null default '[]'::jsonb,
  status              text not null default 'raw'
                      check (status in ('pending', 'raw', 'under_review', 'approved',
                                        'rejected', 'failed')),
  approved_by         uuid references auth.users (id) on delete set null,
  approved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null
);
create index if not exists transcripts_audio_idx on public.transcripts (audio_entry_id);

-- Memória episódica: o que foi relatado. Nunca preencher lacunas.
create table if not exists public.episodes (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  transcript_id  uuid references public.transcripts (id) on delete set null,
  audio_entry_id uuid references public.audio_entries (id) on delete set null,
  title          text,
  summary        text,
  narrative      text not null,
  occurred_on    date,
  temporality    text,
  themes         text[] not null default '{}',
  entities       jsonb not null default '[]'::jsonb,
  projects       text[] not null default '{}',
  status         text not null default 'active'
                 check (status in ('candidate', 'active', 'corrected', 'archived', 'excluded')),
  tsv            tsvector generated always as
                 (to_tsvector('public.pt_unaccent'::regconfig,
                    coalesce(title, '') || ' ' || coalesce(narrative, ''))) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id) on delete set null
);
create index if not exists episodes_tsv_idx on public.episodes using gin (tsv);
create index if not exists episodes_ws_date_idx on public.episodes (workspace_id, occurred_on desc);

create table if not exists public.reflection_sessions (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  audio_entry_id       uuid references public.audio_entries (id) on delete set null,
  transcript_id        uuid references public.transcripts (id) on delete set null,
  episode_id           uuid references public.episodes (id) on delete set null,
  retrieval_session_id uuid,
  dossier_id           uuid,
  style_profile_id     uuid,
  central_question     text,
  intent               text,
  status               text not null default 'draft'
                       check (status in ('draft', 'awaiting_transcription', 'transcript_review',
                                         'investigating', 'needs_conflict_review',
                                         'dossier_ready', 'writing', 'editing',
                                         'approved', 'failed', 'archived')),
  status_reason        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id) on delete set null
);
create index if not exists reflection_sessions_ws_idx on public.reflection_sessions (workspace_id, created_at desc);

create table if not exists public.reflections (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  session_id          uuid not null references public.reflection_sessions (id) on delete cascade,
  title               text,
  current_version_id  uuid,
  approved_version_id uuid,
  status              text not null default 'draft'
                      check (status in ('draft', 'editing', 'approved', 'archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null
);

-- Nunca sobrescrever: cada alteração cria uma nova versão.
create table if not exists public.reflection_versions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  reflection_id     uuid not null references public.reflections (id) on delete cascade,
  parent_version_id uuid references public.reflection_versions (id) on delete set null,
  version_number    int not null,
  text              text not null,
  text_hash         text not null,
  word_count        int,
  origin            text not null default 'ai'
                    check (origin in ('ai', 'human_edit', 'import')),
  model             text,
  prompt_version_id uuid,
  style_profile_id  uuid,
  diff_summary      text,
  status            text not null default 'draft'
                    check (status in ('draft', 'edited', 'approved', 'superseded', 'archived')),
  approved_by       uuid references auth.users (id) on delete set null,
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null,
  unique (reflection_id, version_number)
);
create index if not exists reflection_versions_reflection_idx
  on public.reflection_versions (reflection_id, version_number desc);

alter table public.reflections
  add constraint reflections_current_version_fk
  foreign key (current_version_id) references public.reflection_versions (id) on delete set null;
alter table public.reflections
  add constraint reflections_approved_version_fk
  foreign key (approved_version_id) references public.reflection_versions (id) on delete set null;

create table if not exists public.reflection_sources (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  reflection_version_id uuid not null references public.reflection_versions (id) on delete cascade,
  source_id             uuid references public.sources (id) on delete set null,
  source_version_id     uuid references public.source_versions (id) on delete set null,
  section_id            uuid references public.source_sections (id) on delete set null,
  chunk_id              uuid references public.source_chunks (id) on delete set null,
  claim_id              uuid references public.claims (id) on delete set null,
  evidence_id           uuid references public.claim_evidence (id) on delete set null,
  episode_id            uuid references public.episodes (id) on delete set null,
  memory_id             uuid references public.memories (id) on delete set null,
  role                  text not null default 'support'
                        check (role in ('support', 'complement', 'contrast', 'context', 'quote')),
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null
);
create index if not exists reflection_sources_version_idx
  on public.reflection_sources (reflection_version_id);

create table if not exists public.reflection_audio_versions (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  reflection_version_id uuid not null references public.reflection_versions (id) on delete cascade,
  voice_profile_id      uuid,
  storage_bucket        text not null default 'audio-generated',
  storage_path          text,
  mime_type             text default 'audio/mpeg',
  byte_size             bigint,
  duration_seconds      numeric(10, 2),
  provider              text,
  model                 text,
  voice_id              text,
  text_hash             text not null,
  status                text not null default 'pending'
                        check (status in ('pending', 'generating', 'ready', 'failed', 'archived')),
  error_message         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null
);
create index if not exists reflection_audio_version_idx
  on public.reflection_audio_versions (reflection_version_id);

create trigger set_updated_at before update on public.audio_entries
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.transcripts
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.episodes
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.reflection_sessions
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.reflections
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.reflection_versions
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.reflection_audio_versions
  for each row execute function public.tg_set_updated_at();

select public.apply_workspace_rls(t) from unnest(array[
  'audio_entries', 'transcripts', 'episodes', 'reflection_sessions',
  'reflections', 'reflection_versions', 'reflection_sources',
  'reflection_audio_versions'
]) as t;

select public.assert_rls_enabled();
