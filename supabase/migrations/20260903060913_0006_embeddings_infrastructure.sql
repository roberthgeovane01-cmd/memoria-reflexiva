-- =========================================================================
-- 0006 — Infraestrutura de embeddings
-- Um "espaço de embedding" identifica provider + modelo + dimensões + versão.
-- Vetores de espaços diferentes NUNCA são comparados entre si.
-- =========================================================================

create table if not exists public.embedding_spaces (
  id         uuid primary key default gen_random_uuid(),
  provider   text not null,
  model      text not null,
  dimensions int not null check (dimensions between 1 and 2000),
  version    int not null default 1,
  is_active  boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  unique (provider, model, dimensions, version)
);

alter table public.embedding_spaces enable row level security;
create policy "espacos: leitura autenticada" on public.embedding_spaces
  for select to authenticated using (true);

insert into public.embedding_spaces (provider, model, dimensions, version, is_active, notes)
values
  ('openai', 'text-embedding-3-small', 1536, 1, true, 'Espaço padrão de produção'),
  ('mock', 'deterministic-hash-1536', 1536, 1, false, 'Modo demonstração — hashing determinístico')
on conflict do nothing;

create table if not exists public.embeddings (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  embedding_space_id uuid not null references public.embedding_spaces (id) on delete cascade,
  owner_kind         text not null
                     check (owner_kind in ('source_summary', 'section_summary', 'chunk',
                                           'claim', 'concept', 'episode', 'reflection')),
  owner_id           uuid not null,
  source_id          uuid references public.sources (id) on delete cascade,
  embedding          extensions.vector(1536) not null,
  created_at         timestamptz not null default now(),
  unique (owner_kind, owner_id, embedding_space_id)
);

create or replace function public.tg_check_embedding_dimensions()
returns trigger language plpgsql as $$
declare v_dims int;
begin
  select dimensions into v_dims from public.embedding_spaces where id = new.embedding_space_id;
  if v_dims is null then
    raise exception 'Espaço de embedding inexistente: %', new.embedding_space_id;
  end if;
  if extensions.vector_dims(new.embedding) <> v_dims then
    raise exception 'Dimensões incompatíveis: vetor tem %, espaço % espera %',
      extensions.vector_dims(new.embedding), new.embedding_space_id, v_dims;
  end if;
  return new;
end;
$$;

drop trigger if exists check_embedding_dimensions on public.embeddings;
create trigger check_embedding_dimensions
  before insert or update on public.embeddings
  for each row execute function public.tg_check_embedding_dimensions();

create index if not exists embeddings_owner_idx on public.embeddings (owner_kind, owner_id);
create index if not exists embeddings_ws_space_idx
  on public.embeddings (workspace_id, embedding_space_id, owner_kind);
create index if not exists embeddings_source_idx on public.embeddings (source_id);

create index if not exists embeddings_hnsw_chunk_idx on public.embeddings
  using hnsw (embedding extensions.vector_cosine_ops) where owner_kind = 'chunk';
create index if not exists embeddings_hnsw_section_idx on public.embeddings
  using hnsw (embedding extensions.vector_cosine_ops) where owner_kind = 'section_summary';
create index if not exists embeddings_hnsw_source_idx on public.embeddings
  using hnsw (embedding extensions.vector_cosine_ops) where owner_kind = 'source_summary';
create index if not exists embeddings_hnsw_claim_idx on public.embeddings
  using hnsw (embedding extensions.vector_cosine_ops) where owner_kind = 'claim';
create index if not exists embeddings_hnsw_episode_idx on public.embeddings
  using hnsw (embedding extensions.vector_cosine_ops) where owner_kind = 'episode';
create index if not exists embeddings_hnsw_reflection_idx on public.embeddings
  using hnsw (embedding extensions.vector_cosine_ops) where owner_kind = 'reflection';

select public.apply_workspace_rls('embeddings');
select public.assert_rls_enabled();
