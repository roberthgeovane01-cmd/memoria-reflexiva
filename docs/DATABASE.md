# Banco de dados

PostgreSQL 17 no Supabase. Tudo é reproduzível pelas migrations em
`supabase/migrations/` — não há nada criado à mão.

## Migrations

| Arquivo | O que faz                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------- |
| `0001`  | extensões (pgvector, pg_trgm, unaccent, pgcrypto), configuração de busca `pt_unaccent`, trigger de `updated_at` |
| `0002`  | `profiles`, `workspaces`, `workspace_members`, provisionamento no cadastro                                      |
| `0003`  | buckets privados e políticas de Storage                                                                         |
| `0004`  | gerador de políticas RLS padrão                                                                                 |
| `0005`  | biblioteca hierárquica                                                                                          |
| `0006`  | `embedding_spaces`, `embeddings` e índices HNSW parciais                                                        |
| `0007`  | memória semântica: conceitos, afirmações, evidências, relações, memórias                                        |
| `0008`  | áudio, transcrições, episódios, reflexões versionadas                                                           |
| `0009`  | investigação: sessões, consultas, resultados, dossiê, conflitos                                                 |
| `0010`  | estilo, voz, fila de jobs, prompts, consentimento, auditoria                                                    |
| `0011`  | funções de busca, fila e enforcement de TTS                                                                     |
| `0012`  | endurecimento: helpers para o schema privado `mr`, `search_path` fixo                                           |
| `0013`  | `mr_vector_from_sparse` (utilitário de seed e teste)                                                            |
| `0014`  | correção de tipo em `mr_hybrid_search` (achada pela prova do cérebro)                                           |
| `0015`  | busca lexical com OR + bônus estrito (achada pela prova do cérebro)                                             |

## Campos obrigatórios

Toda entidade de domínio tem `id uuid`, `workspace_id`, `created_at`,
`updated_at`, `created_by` e `status`, com chaves estrangeiras, constraints e
índices adequados.

## Grupos de tabelas

**Identidade** — `profiles`, `workspaces`, `workspace_members`

**Biblioteca** — `sources`, `source_versions`, `source_sections`,
`source_summaries`, `source_chunks`, `tags`, `source_tags`

**Vetores** — `embedding_spaces`, `embeddings`

**Memória semântica** — `concepts`, `source_concepts`, `claims`,
`claim_evidence`, `claim_relations`, `memories`, `memory_relations`

**Áudio e reflexão** — `audio_entries`, `transcripts`, `episodes`,
`reflection_sessions`, `reflections`, `reflection_versions`,
`reflection_sources`, `reflection_audio_versions`

**Investigação** — `retrieval_sessions`, `retrieval_queries`, `retrieval_hits`,
`memory_dossiers`, `dossier_evidence`, `conflicts`, `conflict_resolutions`

**Estilo e voz** — `style_profiles`, `style_examples`, `voice_profiles`

**Infraestrutura** — `processing_jobs`, `prompt_versions`, `consent_logs`,
`audit_logs`

## Funções

| Função                                             | Uso                                        |
| -------------------------------------------------- | ------------------------------------------ |
| `mr_search_vector`                                 | busca vetorial em qualquer nível           |
| `mr_search_chunks_fulltext`                        | busca textual em trechos                   |
| `mr_search_summaries_fulltext`                     | busca textual em resumos (global ou seção) |
| `mr_search_claims_fulltext`                        | busca textual em afirmações                |
| `mr_search_episodes_fulltext`                      | busca textual em relatos                   |
| `mr_hybrid_search`                                 | fusão RRF entre vetorial e textual         |
| `mr_chunk_window`                                  | vizinhança de um trecho                    |
| `mr_claim_job` / `mr_complete_job` / `mr_fail_job` | fila de trabalhos                          |
| `mr_tsquery_or` / `mr_tsquery_strict`              | montagem das consultas textuais            |
| `mr_vector_from_sparse`                            | utilitário para seeds e testes             |

Todas as funções de busca são `SECURITY INVOKER`: a RLS continua valendo.

## Triggers de regra de negócio

| Trigger                         | Garante                                         |
| ------------------------------- | ----------------------------------------------- |
| `on_auth_user_created`          | perfil, workspace, estilo e voz no cadastro     |
| `check_embedding_dimensions`    | vetor com a dimensão declarada pelo espaço      |
| `enforce_tts_requires_approval` | voz só para versão aprovada, com hash conferido |
| `freeze_approved_version`       | texto de versão aprovada é imutável             |
| `source_summaries_tsv`          | mantém o índice textual dos resumos             |

## Exclusão

`on delete cascade` a partir de `sources` remove versões, seções, resumos,
trechos, vetores, vínculos de conceito, afirmações e evidências. O arquivo
original é removido do Storage pela ação `deleteSource` antes do delete. Não
ficam dados órfãos.

## Gerar tipos TypeScript

```bash
npx supabase gen types typescript --project-id SEU_REF > src/lib/database.types.ts
```
