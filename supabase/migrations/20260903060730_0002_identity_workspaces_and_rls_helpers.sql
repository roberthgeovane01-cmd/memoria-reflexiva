-- =========================================================================
-- 0002 — Identidade: profiles, workspaces, membros e helpers de RLS
-- NOTA: os helpers criados aqui em `public` foram movidos para o schema
-- privado `mr` pela migration 0012. Esta migration é mantida como registro
-- histórico e continua sendo executável do zero.
-- =========================================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  locale       text not null default 'pt-BR',
  status       text not null default 'active' check (status in ('active', 'disabled')),
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique,
  owner_id   uuid not null references auth.users (id) on delete restrict,
  status     text not null default 'active' check (status in ('active', 'archived')),
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index if not exists workspaces_owner_idx on public.workspaces (owner_id);

create table if not exists public.workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'owner' check (role in ('owner', 'editor', 'reader')),
  status       text not null default 'active' check (status in ('active', 'revoked')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null,
  unique (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members (user_id, status);

create trigger set_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.workspaces
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.workspace_members
  for each row execute function public.tg_set_updated_at();

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.can_edit_workspace(p_workspace_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'editor')
  );
$$;

create or replace function public.current_workspace_ids()
returns setof uuid language sql stable security definer
set search_path = public, pg_temp as $$
  select m.workspace_id from public.workspace_members m
  where m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function public.tg_handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_workspace_id uuid;
  v_name text;
begin
  v_name := coalesce(new.raw_user_meta_data ->> 'display_name',
                     split_part(coalesce(new.email, 'usuario'), '@', 1));
  insert into public.profiles (id, display_name) values (new.id, v_name)
  on conflict (id) do nothing;
  insert into public.workspaces (name, owner_id, created_by)
  values ('Biblioteca de ' || v_name, new.id, new.id)
  returning id into v_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, role, created_by)
  values (v_workspace_id, new.id, 'owner', new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_handle_new_user();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "perfil proprio: ler" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "perfil proprio: atualizar" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "workspace: ler se membro" on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));
create policy "workspace: criar como dono" on public.workspaces
  for insert to authenticated with check (owner_id = auth.uid());
create policy "workspace: atualizar se dono" on public.workspaces
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "workspace: excluir se dono" on public.workspaces
  for delete to authenticated using (owner_id = auth.uid());

create policy "membros: ler se membro" on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "membros: gerir se dono" on public.workspace_members
  for all to authenticated
  using (exists (select 1 from public.workspaces w
                 where w.id = workspace_id and w.owner_id = auth.uid()))
  with check (exists (select 1 from public.workspaces w
                      where w.id = workspace_id and w.owner_id = auth.uid()));
