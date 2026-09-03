# Ingestão de documentos

```
UPLOAD → STORAGE PRIVADO → CRIAR SOURCE → SHA-256 → DEDUPLICAÇÃO
       → EXTRAÇÃO → NORMALIZAÇÃO → ESTRUTURA → CAPÍTULOS
       → RESUMO GLOBAL → RESUMOS DE SEÇÃO → CHUNKING → EMBEDDINGS
       → CONCEITOS → CLAIMS → INDEXAÇÃO → READY
```

Implementação em `src/services/library/ingest.ts`, executada pela fila
(`processing_jobs`, tipo `ingest_source`).

## Upload

O arquivo sobe **direto do navegador** para o Supabase Storage, sob RLS. O
servidor só cria os registros e devolve o caminho. Assim um livro de 50 MB não
passa por uma Server Action.

## Deduplicação

SHA-256 do conteúdo, único por workspace. Um documento idêntico já presente é
recusado com explicação, em vez de duplicar a memória.

## Normalização

Conservadora, e sempre em coluna separada do texto bruto:

- remove caracteres de controle e hífen suave;
- reconstrói palavras hifenizadas na quebra de linha (`presen-\nça` → `presença`);
- junta linhas soltas do mesmo parágrafo;
- colapsa espaços e quebras excessivas.

## Detecção de estrutura

Em ordem de preferência: títulos markdown → palavras estruturais em português
(`Capítulo`, `Parte`, `Prefácio`, `Anexo`…) → linhas curtas isoladas em caixa
alta ou numeradas.

Se nada aparecer, o documento é `flat`: uma seção única. **Nunca inventamos
capítulos.** E se aparecer um "capítulo" a cada duas linhas, isso é ruído de
extração, não estrutura — o detector descarta.

## Chunking

Nunca "a cada N caracteres". A ordem de respeito é
**seção → parágrafo → frase**. Um parágrafo só é dividido quando sozinho
ultrapassa o teto, e mesmo assim em fronteira de frase.

Cada trecho guarda `source_id`, `source_version_id`, `section_id`, `sequence`,
`heading_path`, `char_start`, `char_end`, `page_start`, `page_end`, `text`,
`hash` e `token_count`.

A sobreposição (padrão: 60 tokens) repete o fim do trecho anterior no começo do
seguinte, para que uma ideia partida ao meio continue legível quando recuperada
isoladamente.

## Resumos

Resumo global do documento e resumo por seção. Os dois são **instrumentos de
busca**, não resenhas: preservam os assuntos, o vocabulário característico e as
questões que o texto enfrenta. Sem modelo de linguagem, o resumo é extrativo —
frases reais do texto, escolhidas por frequência de termos e posição.

## Conceitos e afirmações

Conceitos são noções que o texto trabalha ("presença", "lealdade", "silêncio").
Nascem como `candidate`.

Afirmações precisam de **citação literal**: se a citação não existir
caractere a caractere dentro do trecho, a afirmação é descartada. É isso que
garante o caminho de volta `claim → evidence → chunk → section → source`.

Em livros longos, a extração de afirmações amostra os trechos mais substantivos
(até 40). O restante continua pesquisável por embedding e por texto.

## Progresso e falhas

O job publica progresso e rótulo a cada etapa. Falhas usam backoff exponencial
(`20s × 3^tentativa`) até `max_attempts`, com `correlation_id` e chave de
idempotência (`ingest:<source_version_id>`).
