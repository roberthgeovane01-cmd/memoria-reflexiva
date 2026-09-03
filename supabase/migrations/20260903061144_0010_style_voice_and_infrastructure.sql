-- =========================================================================
-- 0010 — Identidade de escrita, voz e infraestrutura operacional
-- Estilo é separado de conhecimento factual: a Biblioteca responde "o que
-- sabemos"; o Style Profile responde "como devemos escrever".
-- =========================================================================

create table if not exists public.style_profiles (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  name                  text not null,
  version               int not null default 1,
  is_default            boolean not null default false,
  tone                  text,
  perspective           text default 'primeira pessoa',
  target_length         text default 'media',
  rhythm                text,
  structure             text,
  poeticity             int check (poeticity between 0 and 5),
  metaphor_level        int check (metaphor_level between 0 and 5),
  vocabulary_notes      text,
  preferred_expressions text[] not null default '{}',
  forbidden_expressions text[] not null default '{}',
  guidelines            text,
  authorized_values     text[] not null default '{}',
  safety_rules          text[] not null default '{}',
  status                text not null default 'active'
                        check (status in ('draft', 'active', 'superseded', 'archived')),
  supersedes_id         uuid references public.style_profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null,
  unique (workspace_id, name, version)
);
create unique index if not exists style_profiles_default_uidx
  on public.style_profiles (workspace_id) where is_default and status = 'active';

create table if not exists public.style_examples (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  style_profile_id      uuid not null references public.style_profiles (id) on delete cascade,
  kind                  text not null check (kind in ('approved', 'rejected')),
  text                  text not null,
  note                  text,
  source_id             uuid references public.sources (id) on delete set null,
  reflection_version_id uuid references public.reflection_versions (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null
);
create index if not exists style_examples_profile_idx on public.style_examples (style_profile_id, kind);

create table if not exists public.voice_profiles (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  name             text not null,
  provider         text not null default 'elevenlabs',
  voice_id         text,
  model            text,
  settings         jsonb not null default '{}'::jsonb,
  is_default       boolean not null default false,
  is_cloned        boolean not null default false,
  consent_status   text not null default 'not_required'
                   check (consent_status in ('not_required', 'pending', 'granted', 'revoked')),
  consent_subject  text,
  consent_evidence text,
  status           text not null default 'active'
                   check (status in ('active', 'disabled', 'archived')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null
);
create unique index if not exists voice_profiles_default_uidx
  on public.voice_profiles (workspace_id) where is_default and status = 'active';

-- Voz clonada exige consentimento explícito registrado.
alter table public.voice_profiles drop constraint if exists voice_profiles_clone_consent_chk;
alter table public.voice_profiles add constraint voice_profiles_clone_consent_chk
  check (not is_cloned or consent_status = 'granted');

alter table public.reflection_audio_versions
  add constraint reflection_audio_voice_fk
  foreign key (voice_profile_id) references public.voice_profiles (id) on delete set null;
alter table public.reflection_sessions
  add constraint reflection_sessions_style_fk
  foreign key (style_profile_id) references public.style_profiles (id) on delete set null;
alter table public.reflection_versions
  add constraint reflection_versions_style_fk
  foreign key (style_profile_id) references public.style_profiles (id) on delete set null;

create table if not exists public.prompt_versions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  version     int not null,
  purpose     text not null,
  model_hint  text,
  template    text not null,
  schema_name text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (name, version)
);
alter table public.prompt_versions enable row level security;
create policy "prompts: leitura autenticada" on public.prompt_versions
  for select to authenticated using (true);

create table if not exists public.processing_jobs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  kind            text not null
                  check (kind in ('ingest_source', 'ocr', 'structure', 'summarize',
                                  'chunk', 'embed', 'extract_concepts', 'extract_claims',
                                  'transcribe', 'investigate', 'write_reflection', 'tts')),
  status          text not null default 'pending'
                  check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  priority        int not null default 100,
  payload         jsonb not null default '{}'::jsonb,
  result          jsonb not null default '{}'::jsonb,
  progress        numeric(5, 2) not null default 0,
  progress_label  text,
  attempts        int not null default 0,
  max_attempts    int not null default 3,
  correlation_id  uuid not null default gen_random_uuid(),
  idempotency_key text,
  locked_at       timestamptz,
  locked_by       text,
  run_after       timestamptz not null default now(),
  error_message   text,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null
);
create unique index if not exists processing_jobs_idempotency_uidx
  on public.processing_jobs (workspace_id, kind, idempotency_key)
  where idempotency_key is not null;
create index if not exists processing_jobs_queue_idx on public.processing_jobs (status, run_after, priority);
create index if not exists processing_jobs_ws_idx on public.processing_jobs (workspace_id, status, created_at desc);

create table if not exists public.consent_logs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  subject      text not null,
  scope        text not null,
  granted      boolean not null,
  evidence     text,
  granted_by   uuid references auth.users (id) on delete set null,
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null
);

create table if not exists public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  actor_id       uuid references auth.users (id) on delete set null,
  actor_kind     text not null default 'user' check (actor_kind in ('user', 'system', 'ai')),
  action         text not null,
  entity_kind    text,
  entity_id      uuid,
  before_state   jsonb,
  after_state    jsonb,
  provider       text,
  model          text,
  latency_ms     int,
  tokens_in      int,
  tokens_out     int,
  estimated_cost numeric(12, 6),
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists audit_logs_ws_idx on public.audit_logs (workspace_id, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_kind, entity_id);

create trigger set_updated_at before update on public.style_profiles
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.style_examples
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.voice_profiles
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.processing_jobs
  for each row execute function public.tg_set_updated_at();

select public.apply_workspace_rls(t) from unnest(array[
  'style_profiles', 'style_examples', 'voice_profiles',
  'processing_jobs', 'consent_logs', 'audit_logs'
]) as t;

-- audit_logs é somente-anexar do ponto de vista do usuário.
drop policy if exists "ws_update" on public.audit_logs;
drop policy if exists "ws_delete" on public.audit_logs;

select public.assert_rls_enabled();
