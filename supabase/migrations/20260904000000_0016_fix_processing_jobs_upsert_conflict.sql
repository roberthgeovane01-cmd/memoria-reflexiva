-- =========================================================================
-- 0016 — Corrige o upsert de processing_jobs
--
-- `processing_jobs_idempotency_uidx` era um índice único PARCIAL
-- (`where idempotency_key is not null`). O Postgres só usa um índice único
-- parcial como alvo de `ON CONFLICT (colunas)` quando a cláusula ON CONFLICT
-- repete o mesmo predicado WHERE — o que o cliente supabase-js não faz ao
-- montar `.upsert(..., { onConflict: "workspace_id,kind,idempotency_key" })`.
-- Resultado em produção: toda tentativa de enfileirar um job (por exemplo,
-- ao adicionar um documento na Biblioteca) falhava com
-- "42P10: there is no unique or exclusion constraint matching the ON
-- CONFLICT specification".
--
-- Um índice único comum sobre as três colunas já garante exatamente o
-- comportamento desejado: no Postgres, valores NULL nunca colidem entre si
-- em uma constraint UNIQUE, então múltiplos jobs sem idempotency_key
-- continuam permitidos, e o predicado `where idempotency_key is not null`
-- era desnecessário desde o início.
-- =========================================================================

drop index if exists public.processing_jobs_idempotency_uidx;

create unique index if not exists processing_jobs_idempotency_uidx
  on public.processing_jobs (workspace_id, kind, idempotency_key);
