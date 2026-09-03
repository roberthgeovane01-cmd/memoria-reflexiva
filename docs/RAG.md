# Recuperação: busca híbrida e hierárquica

## O problema que isto resolve

Uma busca vetorial sozinha erra quando o vocabulário é específico. Uma busca
textual sozinha erra quando a pessoa usa outras palavras. E as duas, sozinhas,
deixam livros inteiros de fora quando o assunto aparece só no meio do texto.

## Os quatro caminhos

```
NÍVEL GLOBAL      resumos de documento     "quais livros podem ter relação?"
NÍVEL SEÇÃO       resumos de capítulo      "onde, nesses livros, isso aparece?"
NÍVEL EVIDÊNCIA   trechos dos livros       "qual é a evidência concreta?"
BUSCA DIRETA      todos os trechos         varre a biblioteca inteira em paralelo
```

A busca direta existe justamente para o caso em que o resumo do livro não
mencionou o tema. Sem ela, o funil hierárquico esconderia material relevante.

Todo documento ativo tem um resumo global com vetor próprio, então **toda a
biblioteca participa da primeira seleção** — sem que nenhum livro completo
precise ser enviado ao modelo.

## Fusão

Cada consulta produz duas listas — vetorial e textual — em cada nível.
Elas são combinadas por **Reciprocal Rank Fusion**:

```
score(d) = Σ_listas  peso_lista / (k + posição(d))      k = 60
```

RRF é usado porque os scores das duas buscas vivem em escalas incompatíveis;
o que se compara é a _posição_, não o valor. Pesos atuais: evidência 1,15;
busca direta 1,0; afirmações 0,9; episódios 0,9.

## Busca textual em português

- Configuração `public.pt_unaccent`: cópia da `portuguese` com `unaccent` no
  mapeamento. Buscar "silencio" encontra "silêncio"; o texto original mantém os
  acentos.
- A consulta é montada com **OR** (`mr_tsquery_or`) para recall, e o trecho que
  também satisfaz a consulta estrita (`websearch_to_tsquery`, com AND e frases)
  recebe **bônus de 2x**. `ts_rank_cd` já favorece quem casa mais termos e com
  maior proximidade entre eles.

> Esta decisão veio da prova do cérebro: com AND puro, uma consulta de seis
> palavras casava com quase nada e a metade lexical da fusão ficava inútil.

## Vetores

`embedding_spaces` identifica provider + modelo + dimensões + versão. A tabela
`embeddings` é polimórfica (`owner_kind` + `owner_id`) e um trigger recusa
qualquer vetor com dimensão diferente da declarada pelo espaço.

Índices HNSW **parciais**, um por tipo de dono, evitam o problema clássico de
pós-filtragem do HNSW:

```sql
create index ... using hnsw (embedding vector_cosine_ops) where owner_kind = 'chunk';
```

Trocar de modelo de embedding significa criar um novo espaço e reindexar.
Vetores de espaços diferentes nunca são comparados.

## Reranking

`RerankingProvider` com implementação heurística explicável — cada componente
volta em `reasons` e vai para a auditoria:

| Componente     | Peso | O que mede                                      |
| -------------- | ---- | ----------------------------------------------- |
| similaridade   | 0,40 | score da fusão, normalizado                     |
| pertinência    | 0,28 | cobertura dos termos da questão central         |
| especificidade | 0,10 | penaliza trechos curtos demais ou longos demais |
| autoridade     | 0,16 | escala 1–5 da fonte                             |
| recência       | 0,06 | material mais recente ganha um empurrão suave   |

## Diversidade de fontes

Um livro com cem trechos parecidos não pode apagar um livro com dois trechos
muito relevantes. A cada novo trecho da **mesma** fonte aplica-se uma penalidade
crescente (`1 - (1-0,35)^n`) e existe um teto por fonte — que só age quando há
outra fonte candidata.

O teto é uma preferência, não um desperdício: se sobrarem vagas depois de
respeitá-lo, elas são preenchidas pelos melhores candidatos já penalizados.

## Vizinhança

Ao selecionar um trecho, `mr_chunk_window` traz o anterior e o seguinte da mesma
versão do documento, marcados com `[…]`. Uma frase recuperada sozinha pode
significar o contrário do que significa no parágrafo.

## Persistência

`retrieval_sessions`, `retrieval_queries` e `retrieval_hits` guardam a
investigação inteira: consultas, filtros, modelo, parâmetros, scores de cada
etapa, penalidade de diversidade, o que foi escolhido, o que foi descartado e
o motivo do descarte. É isso que faz a tela de auditoria existir.

## Métricas

`Precision@K`, `Recall@K`, `MRR` e diversidade de fontes estão implementadas em
`src/services/retrieval/fusion.ts` e são avaliadas **separadamente da prosa**.
Um dossiê bem escrito com recuperação ruim é um problema pior do que o contrário.
