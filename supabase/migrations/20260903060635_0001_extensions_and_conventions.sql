-- =========================================================================
-- 0001 — Extensões, configuração de busca textual em português e convenções
-- =========================================================================

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Configuração de Full Text Search para português SEM acentos.
-- O texto original (com acentos) é sempre preservado; a normalização
-- acontece apenas no índice de busca.
do $$
begin
  if not exists (
    select 1 from pg_ts_config c
    join pg_namespace n on n.oid = c.cfgnamespace
    where c.cfgname = 'pt_unaccent' and n.nspname = 'public'
  ) then
    execute 'create text search configuration public.pt_unaccent (copy = portuguese)';
    execute 'alter text search configuration public.pt_unaccent
             alter mapping for hword, hword_part, word
             with unaccent, portuguese_stem';
  end if;
end
$$;

-- Trigger genérico de updated_at
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.tg_set_updated_at is
  'Mantém updated_at sincronizado em qualquer tabela que use este trigger.';
