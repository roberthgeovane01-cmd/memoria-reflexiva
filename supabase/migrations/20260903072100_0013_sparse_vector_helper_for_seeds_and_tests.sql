-- =========================================================================
-- 0013 — Utilitário para seeds e testes
-- Constrói um vetor de N dimensões a partir de sua representação esparsa.
-- O hashing vectorizer do modo demonstração produz poucos componentes não
-- nulos, então esta função permite semear dados de teste sem despejar 1536
-- números por linha.
-- =========================================================================

create or replace function public.mr_vector_from_sparse(
  p_dims int,
  p_idx  int[],
  p_val  float8[]
)
returns extensions.vector
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
declare
  v float8[] := array_fill(0::float8, array[p_dims]);
  i int;
begin
  if array_length(p_idx, 1) is distinct from array_length(p_val, 1) then
    raise exception 'Índices e valores precisam ter o mesmo tamanho.';
  end if;

  for i in 1..coalesce(array_length(p_idx, 1), 0) loop
    if p_idx[i] < 0 or p_idx[i] >= p_dims then
      raise exception 'Índice fora do intervalo: %', p_idx[i];
    end if;
    v[p_idx[i] + 1] := p_val[i];
  end loop;

  return replace(replace(v::text, '{', '['), '}', ']')::extensions.vector;
end;
$$;

revoke execute on function public.mr_vector_from_sparse(int, int[], float8[]) from anon;

comment on function public.mr_vector_from_sparse is
  'Monta um vetor denso a partir de índices e valores esparsos. Usado por seeds e testes.';
