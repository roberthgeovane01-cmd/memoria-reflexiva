-- =========================================================================
-- 0003 — Storage: buckets privados e políticas por workspace
-- Convenção de caminho: <workspace_id>/<dominio>/<entidade_id>/<arquivo>
-- NOTA: helpers movidos para o schema `mr` na migration 0012.
-- =========================================================================

create or replace function public.safe_uuid(p_text text)
returns uuid language plpgsql immutable as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.storage_workspace_id(p_name text)
returns uuid language sql immutable as $$
  select public.safe_uuid((string_to_array(p_name, '/'))[1]);
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('library-originals', 'library-originals', false, 52428800,
   array['application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'text/plain', 'text/markdown', 'text/x-markdown']),
  ('audio-originals', 'audio-originals', false, 104857600,
   array['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a', 'video/webm']),
  ('audio-generated', 'audio-generated', false, 104857600,
   array['audio/mpeg', 'audio/wav', 'audio/ogg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mr: ler arquivos do proprio workspace" on storage.objects;
drop policy if exists "mr: enviar arquivos no proprio workspace" on storage.objects;
drop policy if exists "mr: atualizar arquivos do proprio workspace" on storage.objects;
drop policy if exists "mr: excluir arquivos do proprio workspace" on storage.objects;

create policy "mr: ler arquivos do proprio workspace" on storage.objects
  for select to authenticated
  using (bucket_id in ('library-originals', 'audio-originals', 'audio-generated')
         and public.is_workspace_member(public.storage_workspace_id(name)));

create policy "mr: enviar arquivos no proprio workspace" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('library-originals', 'audio-originals', 'audio-generated')
              and public.can_edit_workspace(public.storage_workspace_id(name)));

create policy "mr: atualizar arquivos do proprio workspace" on storage.objects
  for update to authenticated
  using (bucket_id in ('library-originals', 'audio-originals', 'audio-generated')
         and public.can_edit_workspace(public.storage_workspace_id(name)))
  with check (bucket_id in ('library-originals', 'audio-originals', 'audio-generated')
              and public.can_edit_workspace(public.storage_workspace_id(name)));

create policy "mr: excluir arquivos do proprio workspace" on storage.objects
  for delete to authenticated
  using (bucket_id in ('library-originals', 'audio-originals', 'audio-generated')
         and public.can_edit_workspace(public.storage_workspace_id(name)));
