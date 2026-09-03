# Diário de implementação

## Fase 0 — Fundação do repositório

Next.js 16 + React 19 + TypeScript + Tailwind 4 (App Router), ESLint, Prettier,
Vitest, estrutura de pastas, `.env.example`, CI. Primeiro commit.

**Decisão:** sem FastAPI e sem worker externo. A fila vive no PostgreSQL.

## Fase 1 — Supabase

12 migrations aplicadas e versionadas: extensões e busca em português,
identidade e workspaces, buckets privados, biblioteca hierárquica, vetores,
memória semântica, áudio e reflexões, investigação, estilo e voz, funções de
busca e endurecimento de segurança.

**Testado no banco:** 7 verificações de isolamento por RLS entre dois usuários
— todas passaram. 5 verificações de aprovação e voz — todas passaram.

**Achado:** o linter de segurança apontou funções `SECURITY DEFINER` expostas
pela API e `search_path` mutável. Corrigido na migration `0012`, movendo os
helpers para o schema privado `mr`. Restou um único aviso, de configuração de
painel (_leaked password protection_).

## Fases 2 e 3 — Biblioteca e memória

Pipeline de ingestão completo, chunking estrutural com sobreposição, resumos
global e de seção, embeddings com espaços isolados, conceitos e afirmações com
citação literal obrigatória.

**Decisão:** o embedding do modo demonstração é um hashing vectorizer real, não
um stub. Sem chave de IA o aplicativo continua fazendo busca semântica de
verdade.

## Fase 4 — Recuperação

Busca híbrida (vetorial + textual) com RRF, três níveis hierárquicos mais busca
direta, reranking explicável, diversidade por fonte e vizinhança de trechos.

## Fase 5 — Investigação

Query Planner, Evidence Classifier, Conflict Analyzer e Memory Analyst como
responsabilidades separadas, cada uma com prompt versionado e schema Zod.
Guarda-corpo que remove do dossiê qualquer achado que cite evidência
inexistente.

## Fase 6 — Prova do cérebro

Quatro livros fictícios carregados no banco real (4 fontes, 14 seções, 19
trechos, 30 vetores) e sete verificações executadas. **Dois defeitos reais
encontrados e corrigidos:**

- `mr_hybrid_search` devolvia `numeric` onde a assinatura declara
  `double precision` — toda chamada falhava (migration `0014`);
- a busca textual usava AND, e numa consulta de seis palavras quase nada casava
  — apenas 1 de 14 trechos tinha rank textual (migration `0015`).

Depois da correção: 12 de 14 trechos com rank nas duas listas.

Terceiro ajuste: o teto de diversidade deixava vagas vazias quando uma fonte
tinha poucos candidatos. Passou a preencher com os melhores candidatos já
penalizados.

Detalhes e números em [`BRAIN_PROOF.md`](BRAIN_PROOF.md).

## Fases 7 a 13 — Aplicação

Painel, biblioteca com upload direto ao Storage, memória pesquisável, gravador
no navegador, mesa de revisão de quatro áreas, decisões de conflito, escritor
com versionamento, aprovação com hash, voz bloqueada até a aprovação, download
por URL assinada.

## Fase 14 — Histórico e auditoria

Reconstrução completa de cada sessão e a tela "Como a memória chegou aqui?", com
consultas, scores por etapa, descartes e chamadas de IA.

## Fase 15 — Endurecimento

Foco visível, `aria-*`, contraste, texto alternativo, respeito a
`prefers-reduced-motion`, navegação por teclado, limites de upload, sanitização
de nomes de arquivo e blindagem contra prompt injection em todos os prompts.

## Fase 16 — Publicação

`docs/DEPLOYMENT.md` com o roteiro e o smoke test de 12 passos.

## Pendências assumidas

- E2E automatizado com Playwright exige um projeto Supabase descartável.
- OCR não vem configurado: PDFs digitalizados ficam em `ocr_required`, por
  decisão explícita de não contaminar a memória.
- O stemmer do modo demonstração é grosseiro; irrelevante quando há chave de IA.
- _Leaked password protection_ precisa ser ligada à mão no painel do Supabase.
