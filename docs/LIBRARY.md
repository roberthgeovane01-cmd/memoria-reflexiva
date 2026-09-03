# Biblioteca

A Biblioteca responde: **o que foi colocado no sistema?**

## Estrutura obrigatória

Um livro nunca é apenas "PDF + trechos":

```
SOURCE
  └─ SOURCE VERSION            (arquivo original, texto bruto, texto normalizado)
       ├─ RESUMO GLOBAL        (é assim que o livro participa da busca global)
       ├─ SEÇÕES / CAPÍTULOS
       │    └─ RESUMOS DE SEÇÃO
       └─ TRECHOS
            ├─ CONCEITOS
            └─ AFIRMAÇÕES → EVIDÊNCIAS
```

## O original é preservado

Três coisas separadas, nunca sobrescritas entre si:

- o arquivo original, no bucket privado `library-originals`;
- `source_versions.raw_text`, o texto extraído como saiu;
- `source_versions.normalized_text`, a versão limpa que alimenta o chunking.

## Formatos

PDF com texto, DOCX, TXT e Markdown. `extractText()` isola o formato do resto do
sistema, então acrescentar um formato novo é escrever mais um caso.

DOCX passa por HTML e depois por markdown mínimo, porque é o caminho que
preserva a hierarquia de títulos — que é o que alimenta a detecção de capítulos.

## PDFs digitalizados

Se a extração devolver menos de 120 caracteres por página, o documento recebe
`ocr_required` e **não entra na memória**. Se a proporção de caracteres úteis
ficar abaixo de 55%, recebe `ocr_low_confidence` e a interface mostra o
percentual. Texto ruim não é melhor que texto nenhum.

## Metadados e filtros

Título, subtítulo, autores, tipo, categoria, tags, idioma, editora, ano,
autoridade (1–5), status, `is_active` e temporalidade (`valid_from`,
`valid_until`). A investigação pode filtrar por qualquer um deles.

`is_active = false` tira o documento da memória sem apagá-lo.

## Tela de detalhe

Mostra arquivo original, metadados, qualidade da extração, motor usado, SHA-256,
resumo global, estrutura de capítulos, conceitos extraídos (com o estado
`candidate`), afirmações com confiança e os primeiros trechos. Permite
reprocessar, editar metadados e excluir.
