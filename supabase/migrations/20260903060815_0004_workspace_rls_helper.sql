-- =========================================================================
-- 0004 — Gerador de políticas RLS padrão por workspace
-- Toda tabela de domínio do usuário recebe exatamente o mesmo contrato:
--   leitura  -> membros ativos do workspace
--   escrita  -> membros com papel owner/editor
-- NOTA: substituído por mr.apply_workspace_rls na migration 0012.
-- =========================================================================

create or replace function public.apply_workspace_rls(p_table text)
returns void language plpgsql as $body$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('alter table public.%I force row level security', p_table);
  execute format('drop policy if exists "ws_select" on public.%I', p_table);
  execute format('drop policy if exists "ws_insert" on public.%I', p_table);
  execute format('drop policy if exists "ws_update" on public.%I', p_table);
  execute format('drop policy if exists "ws_delete" on public.%I', p_table);
  execute format(
    'create policy "ws_select" on public.%I for select to authenticated
       using (public.is_workspace_member(workspace_id))', p_table);
  execute format(
    'create policy "ws_insert" on public.%I for insert to authenticated
       with check (public.can_edit_workspace(workspace_id))', p_table);
  execute format(
    'create policy "ws_update" on public.%I for update to authenticated
       using (public.can_edit_workspace(workspace_id))
       with check (public.can_edit_workspace(workspace_id))', p_table);
  execute format(
    'create policy "ws_delete" on public.%I for delete to authenticated
       using (public.can_edit_workspace(workspace_id))', p_table);
end;
$body$;

create or replace function public.assert_rls_enabled()
returns void language plpgsql as $body$
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
