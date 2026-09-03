# Prova do cérebro

Antes de completar a interface, o núcleo de recuperação foi validado contra um
conjunto de documentos fictícios **no banco de dados real**, não em simulação.

## O conjunto

Quatro livros inventados, em `scripts/brain-proof-corpus.ts`, desenhados para
exercitar exatamente os testes críticos do produto:

| Livro                       | Autoridade | Papel no teste                                                               |
| --------------------------- | ---------- | ---------------------------------------------------------------------------- |
| **A Permanência**           | 4          | muitos trechos parecidos sobre presença — testa o limite de diversidade      |
| **Duas Cartas**             | 5          | poucos trechos, muito relevantes — não pode ser apagado pelo livro dominante |
| **O Silêncio que Abandona** | 4          | contradiz frontalmente "A Permanência" — testa conflito entre fontes         |
| **Notas de Campo**          | 2          | contém tentativa de prompt injection e uma data divergente                   |

Nenhum deles fala de aviação — é a consulta que precisa **declarar ausência**.

O seed é gerado pelo pipeline real (normalização, detecção de estrutura,
chunking, resumo extrativo e o hashing vectorizer do modo demonstração):

```bash
npx tsx scripts/build-brain-proof-seed.ts > supabase/seed/brain-proof.sql
```

Resultado carregado: **4 fontes, 14 seções, 19 trechos, 30 vetores.**

## Resultados medidos

### A — Busca textual em português, insensível a acento

Consulta `silencio presenca` (sem acentos) contra texto acentuado:

| Fonte                   | Score   |
| ----------------------- | ------- |
| O Silêncio que Abandona | 0,03333 |
| A Permanência           | 0,02667 |
| A Permanência           | 0,02111 |
| A Permanência           | 0,01000 |

✅ A configuração `pt_unaccent` funciona: o índice normaliza, o texto original
mantém os acentos.

### B — Nível global: todos os livros participam

Consulta `permanecer em silencio ao lado de quem sofre`:

| Livro                   | Fusão    | Rank vetorial | Rank textual |
| ----------------------- | -------- | ------------- | ------------ |
| A Permanência           | 0,032787 | 1             | 1            |
| O Silêncio que Abandona | 0,032258 | 2             | 2            |
| Notas de Campo          | 0,015873 | 3             | —            |
| Duas Cartas             | 0,015625 | 4             | —            |

✅ Os quatro livros entram na seleção global; os dois que tratam do assunto
lideram nas duas buscas.

### C — Nível intermediário

Sete resumos de capítulo retornados, com "Capítulo 3 — Lealdade e sofrimento" e
"Capítulo 1 — Ficar" no topo. ✅

### D — Nível evidência (antes e depois de uma correção)

A primeira execução expôs **dois defeitos reais**, corrigidos por migrations:

1. **`0014`** — `mr_hybrid_search` devolvia `numeric` onde a assinatura declara
   `double precision`. Toda chamada falhava. Literais como `1.0` são `numeric`
   no PostgreSQL.
2. **`0015`** — a busca textual usava `websearch_to_tsquery`, que liga os termos
   com **AND**. Numa consulta de seis palavras quase nada casava: apenas 1 dos
   14 trechos tinha rank textual, e a metade lexical da fusão ficava inútil.

Depois da correção (OR para recall, bônus de 2x para quem também satisfaz a
consulta estrita):

| #     | Fonte                     | Fusão       | Rank vet. | Rank txt. |
| ----- | ------------------------- | ----------- | --------- | --------- |
| 1     | O Silêncio que Abandona   | 0,031778    | 5         | 1         |
| 2     | A Permanência             | 0,031754    | 4         | 2         |
| 3     | A Permanência             | 0,031258    | 3         | 5         |
| 4     | **Duas Cartas**           | 0,030835    | 2         | 8         |
| 5–10  | A Permanência (6 trechos) | 0,028–0,030 | 9–14      | 3–12      |
| 11–12 | O Silêncio que Abandona   | 0,027       | 17–18     | 9–10      |
| 13–14 | Notas de Campo            | 0,015–0,016 | 1, 6      | —         |

✅ De 1 para 12 trechos com rank nas duas listas. O livro pequeno e de
autoridade 5 aparece em 4º. O livro com a injeção de prompt fica por último.

### E — Vizinhança

`mr_chunk_window(chunk 5, raio 1)` devolveu os trechos 4, 5 e 6 da mesma versão,
com o trecho 5 marcado como centro. ✅

### F — Ausência de memória

Consulta sobre manutenção de turbinas de aviação: **zero** correspondências
textuais e **zero** evidências na busca híbrida. ✅ O dossiê então marca
`has_memory = false` e declara a ausência com todas as letras, em vez de
aproximar qualquer coisa.

### G — Diversidade de fontes

Sem diversidade, "A Permanência" ocuparia 8 das 10 primeiras posições da
consulta principal. Com teto de 2 por fonte e limite 6, as três fontes entram e
nenhuma vaga fica vazia. O teste `tests/unit/investigation.test.ts` roda essa
verificação **com a distribuição de scores exata devolvida pelo banco**.

## O que a prova mudou no sistema

| Achado                                               | Correção                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `mr_hybrid_search` quebrada por tipo                 | migration `0014`                                                                                                |
| Busca lexical com recall baixíssimo                  | migration `0015`                                                                                                |
| Teto de diversidade deixava vagas vazias             | backfill penalizado em `applySourceDiversity`                                                                   |
| Planner heurístico escolhe termos pouco informativos | limitação conhecida do modo demonstração — irrelevante com chave de IA configurada, documentada em `TESTING.md` |

## Reproduzir

```bash
npx tsx scripts/build-brain-proof-seed.ts > supabase/seed/brain-proof.sql
# aplicar o SQL no projeto Supabase e rodar as consultas de docs/TESTING.md
npm test
```

> Ao mudar o tokenizador ou o stemmer do modo demonstração, **bump a versão do
> espaço de embedding** em `embedding_spaces` e regenere o seed. Vetores gerados
> por tokenizadores diferentes não devem ser comparados entre si.
