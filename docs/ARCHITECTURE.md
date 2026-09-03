# Arquitetura

## Decisão central

**Memória antes da escrita.** É proibido o caminho
`áudio → transcrição → LLM → reflexão`. O sistema investiga a biblioteca,
classifica as evidências, detecta conflitos e monta um dossiê rastreável
_antes_ de qualquer geração de texto. O escritor só recebe material já
investigado e já decidido por um ser humano.

## Pilha

| Camada        | Escolha                                         | Por quê                                                                        |
| ------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Aplicação     | Next.js 16, React 19, TypeScript, App Router    | um único runtime, Server Actions eliminam a necessidade de um backend separado |
| Interface     | Tailwind CSS 4, componentes próprios            | sem dependência de CLI interativa; tokens de design em CSS custom properties   |
| Validação     | Zod 4                                           | os mesmos schemas validam formulários e saídas estruturadas da IA              |
| Banco         | Supabase (PostgreSQL 17)                        | Postgres puro com Auth, Storage, RLS e pgvector no mesmo lugar                 |
| Vetores       | pgvector 0.8 com HNSW                           | índices parciais por tipo de dono evitam o problema de pós-filtragem           |
| Busca textual | Full Text Search com configuração `pt_unaccent` | português com stemming, insensível a acento no índice                          |
| Deploy        | Vercel                                          | integra com Next.js sem configuração extra                                     |

**Não existe FastAPI, worker externo ou microserviço.** A fila de trabalhos vive
no próprio PostgreSQL (`processing_jobs` + `mr_claim_job` com
`FOR UPDATE SKIP LOCKED`). Um serviço separado só deve entrar quando houver
necessidade técnica comprovada — OCR pesado é o candidato natural.

## Fluxo completo

```
   gravação ──► audio-originals (privado)
                       │
                       ▼
              SpeechToTextProvider ──► transcripts.raw_transcript
                       │
                       ▼
              REVISÃO HUMANA ──► transcripts.approved_transcript ──► episodes
                       │
                       ▼
              Query Planner ──► retrieval_queries
                       │
        ┌──────────────┼──────────────┬───────────────┐
        ▼              ▼              ▼               ▼
   nível global   nível seção   nível evidência   busca direta
        └──────────────┴──────────────┴───────────────┘
                       │  Reciprocal Rank Fusion
                       ▼
                  Reranking ──► diversidade por fonte ──► vizinhança
                       │
                       ▼
              Evidence Classifier ──► Conflict Analyzer
                       │                      │
                       ▼                      ▼
                Memory Analyst          conflitos abertos
                       │                      │
                       ▼                      ▼
             memory_dossiers  ◄──── DECISÃO HUMANA
                       │
                       ▼
                 Context Pack ──► Reflection Writer
                       │
                       ▼
        reflection_versions (v1, v2, v3 … nunca sobrescritas)
                       │
                       ▼
                APROVAÇÃO HUMANA
                       │
                       ▼
        TextToSpeechProvider ──► audio-generated ──► URL assinada
```

## Providers

Nenhuma parte do sistema fala com um fornecedor de IA diretamente. Tudo passa
por interfaces em `src/ai/providers/types.ts`:

`EmbeddingProvider`, `LanguageModelProvider`, `SpeechToTextProvider`,
`TextToSpeechProvider`, `RerankingProvider`, `OcrProvider`.

Se a chave existe, usa-se o fornecedor real. Se não existe, cai para o **modo
demonstração** — que não é um stub vazio:

- o embedding mock é um _hashing vectorizer_ real, então textos parecidos
  produzem vetores parecidos;
- os resumos são extrativos (frases reais do texto);
- as afirmações carregam a citação literal de onde vieram;
- o dossiê é montado por regras e **declara** que foi montado por regras.

## Identidade e isolamento

`profiles` → `workspaces` → `workspace_members`. Toda tabela de domínio tem
`workspace_id` e RLS **ativada e forçada**. Os helpers de autorização
(`mr.is_workspace_member`, `mr.can_edit_workspace`) vivem no schema privado
`mr`, que o PostgREST não publica.

Quase tudo roda com a identidade do próprio usuário (chave `anon` + sessão), não
com a chave de serviço. Assim a RLS continua sendo a última linha de defesa
mesmo se houver um erro na camada de aplicação.

## Onde ficam as coisas

```
src/
├── app/                 rotas (grupo (auth) público, grupo (app) protegido)
├── components/ui/       kit de interface
├── features/            código por domínio, com Server Actions
├── services/            regras de negócio sem React
│   ├── ingestion/       extração, estrutura, chunking (funções puras)
│   ├── library/         pipeline de ingestão
│   ├── memory/          embeddings
│   ├── retrieval/       fusão, diversidade, métricas (puras) + engine
│   ├── investigation/   classificação, conflitos, dossiê
│   ├── reflection/      context pack e escritor
│   ├── voice/           TTS
│   └── jobs/            worker da fila
├── ai/
│   ├── providers/       adaptadores reais e de demonstração
│   ├── prompts/         prompts versionados
│   └── schemas/         schemas Zod das saídas estruturadas
└── lib/                 env, supabase, auditoria, utilidades
```

As funções puras ficam separadas de propósito: fusão, diversidade, chunking e
métricas são testáveis sem banco e sem rede, e é nelas que mora a inteligência
do ranking.
