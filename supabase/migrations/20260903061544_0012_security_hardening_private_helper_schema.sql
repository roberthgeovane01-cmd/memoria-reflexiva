-- =========================================================================
-- 0012 — Endurecimento de segurança
-- Helpers de autorização saem do schema exposto pela API (public) e passam
-- a viver em `mr`, que o PostgREST não publica. Todas as funções ganham
-- search_path fixo.
-- =========================================================================

drop function if exists public.mr_tmp_dump_migrations();

create schema if not exists mr;
revoke all on schema mr from public;
grant usage on schema mr to authenticated, anon, service_role;

create or replace function mr.is_workspace_member(p_workspace_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active');
$$;

create or replace function mr.can_edit_workspace(p_workspace_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'editor'));
$$;

create or replace function mr.current_workspace_ids()
returns setof uuid language sql stable security definer
set search_path = public, pg_temp as $$
  select m.workspace_id from public.workspace_members m
  where m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function mr.safe_uuid(p_text text)
returns uuid language plpgsql immutable set search_path = pg_temp as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

create or replace function mr.storage_workspace_id(p_name text)
returns uuid language sql immutable set search_path = mr, pg_temp as $$
  select mr.safe_uuid((string_to_array(p_name, '/'))[1]);
$$;

create or replace function mr.apply_workspace_rls(p_table text)
returns void language plpgsql set search_path = public, mr, pg_temp as $body$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('alter table public.%I force row level security', p_table);
  execute format('drop policy if exists "ws_select" on public.%I', p_table);
  execute format('drop policy if exists "ws_insert" on public.%I', p_table);
  execute format('drop policy if exists "ws_update" on public.%I', p_table);
  execute format('drop policy if exists "ws_delete" on public.%I', p_table);
  execute format(
    'create policy "ws_select" on public.%I for select to authenticated
       using (mr.is_workspace_member(workspace_id))', p_table);
  execute format(
    'create policy "ws_insert" on public.%I for insert to authenticated
       with check (mr.can_edit_workspace(workspace_id))', p_table);
  execute format(
    'create policy "ws_update" on public.%I for update to authenticated
       using (mr.can_edit_workspace(workspace_id))
       with check (mr.can_edit_workspace(workspace_id))', p_table);
  execute format(
    'create policy "ws_delete" on public.%I for delete to authenticated
       using (mr.can_edit_workspace(workspace_id))', p_table);
end;
$body$;

create or replace function mr.assert_rls_enabled()
returns void language plpgsql set search_path = public, pg_temp as $body$
declare v_missing text;
begin
  select string_agg(distinct c.relname, ', ') into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join information_schema.columns col
    on col.table_schema = 'public' and col.table_name = c.relname
   and col.column_name = 'workspace_id'
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;
  if v_missing is not null then
    raise exception 'Tabelas com workspace_id e sem RLS: %', v_missing;
  end if;
end;
$body$;

-- Provisionamento de novo usuário: perfil, workspace, estilo e voz padrão.
create or replace function mr.handle_new_user()
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
  insert into public.style_profiles (workspace_id, name, is_default, tone, guidelines, created_by)
  values (v_workspace_id, 'Voz autoral padrão', true,
          'reflexivo, sóbrio, próximo',
          'Escrever em primeira pessoa, sem clichês de autoajuda, sem moralismo, '
          || 'sem afirmar emoções que o autor não declarou. Frases que funcionem bem lidas em voz alta.',
          new.id);
  insert into public.voice_profiles (workspace_id, name, is_default, created_by)
  values (v_workspace_id, 'Voz padrão', true, new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function mr.handle_new_user();

drop policy if exists "workspace: ler se membro" on public.workspaces;
create policy "workspace: ler se membro" on public.workspaces
  for select to authenticated using (mr.is_workspace_member(id));

drop policy if exists "membros: ler se membro" on public.workspace_members;
create policy "membros: ler se membro" on public.workspace_members
  for select to authenticated using (mr.is_workspace_member(workspace_id));

do $$
declare r record;
begin
  for r in
    select distinct c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join information_schema.columns col
      on col.table_schema = 'public' and col.table_name = c.relname
     and col.column_name = 'workspace_id'
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    perform mr.apply_workspace_rls(r.relname);
  end loop;
end
$$;

drop policy if exists "ws_update" on public.audit_logs;
drop policy if exists "ws_delete" on public.audit_logs;

drop policy if exists "mr: ler arquivos do proprio workspace" on storage.objects;
drop policy if exists "mr: enviar arquivos no proprio workspace" on storage.objects;
drop policy if exists "mr: atualizar arquivos do proprio workspace" on storage.objects;
drop policy if exists "mr: excluir arquivos do proprio workspace" on storage.objects;

create policy "mr: ler arquivos do proprio workspace" on storage.objects
  for select to authenticated
  using (bucket_id in ('library-originals', 'audio-originals', 'audio-generated')
         and mr.is_workspace_member(mr.storage_workspace_id(name)));
create policy "mr: enviar arquivos no proprio workspace" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('library-originals', 'audio-originals', 'audio-generated')
              and mr.can_edit_workspace(mr.storage_workspace_id(name)));
create policy "mr: atualizar arquivos do proprio workspace" on storage.objects
  for update to authenticated
  using (bucket_id in ('library-originals', 'audio-originals', 'audio-generated')
         and mr.can_edit_workspace(mr.storage_workspace_id(name)))
  with check (bucket_id in ('library-originals', 'audio-originals', 'audio-generated')
              and mr.can_edit_workspace(mr.storage_workspace_id(name)));
create policy "mr: excluir arquivos do proprio workspace" on storage.objects
  for delete to authenticated
  using (bucket_id in ('library-originals', 'audio-originals', 'audio-generated')
         and mr.can_edit_workspace(mr.storage_workspace_id(name)));

drop function if exists public.is_workspace_member(uuid);
drop function if exists public.can_edit_workspace(uuid);
drop function if exists public.current_workspace_ids();
drop function if exists public.apply_workspace_rls(text);
drop function if exists public.assert_rls_enabled();
drop function if exists public.storage_workspace_id(text);
drop function if exists public.safe_uuid(text);
drop function if exists public.tg_handle_new_user();

alter function public.tg_set_updated_at() set search_path = public, pg_temp;
alter function public.tg_check_embedding_dimensions() set search_path = public, extensions, pg_temp;
alter function public.tg_source_summaries_tsv() set search_path = public, extensions, pg_temp;
alter function public.tg_enforce_tts_requires_approval() set search_path = public, pg_temp;
alter function public.tg_freeze_approved_version() set search_path = public, pg_temp;

revoke execute on function public.tg_set_updated_at() from anon, authenticated;
revoke execute on function public.tg_check_embedding_dimensions() from anon, authenticated;
revoke execute on function public.tg_source_summaries_tsv() from anon, authenticated;
revoke execute on function public.tg_enforce_tts_requires_approval() from anon, authenticated;
revoke execute on function public.tg_freeze_approved_version() from anon, authenticated;

grant execute on all functions in schema mr to authenticated;
revoke execute on function mr.apply_workspace_rls(text) from authenticated, anon, public;
revoke execute on function mr.assert_rls_enabled() from authenticated, anon, public;
revoke execute on function mr.handle_new_user() from authenticated, anon, public;

select mr.assert_rls_enabled();
