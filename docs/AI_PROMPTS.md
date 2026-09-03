# Prompts

Todos em `src/ai/prompts/index.ts`, cada um com `name`, `version`, `purpose`,
`schemaName` e `system`. Toda geração registra qual prompt e qual versão a
produziu, para que uma reflexão de seis meses atrás continue explicável.

**Ao mudar o texto de um prompt, incremente `version`.** Nunca edite em silêncio.

## Catálogo

| Prompt                | v   | Papel                                                 |
| --------------------- | --- | ----------------------------------------------------- |
| `query_planner`       | 1   | transforma a fala em plano de investigação            |
| `concept_extractor`   | 1   | extrai conceitos (não fatos)                          |
| `claim_extractor`     | 1   | extrai afirmações com citação literal                 |
| `evidence_classifier` | 1   | classifica a relação de cada evidência com a fala     |
| `conflict_analyzer`   | 1   | detecta tensões, sem resolvê-las                      |
| `memory_analyst`      | 1   | produz o Dossiê rastreável                            |
| `reflection_writer`   | 1   | escreve a reflexão a partir do Context Pack           |
| `style_analyzer`      | 1   | deriva o perfil de estilo dos textos do próprio autor |
| `source_summarizer`   | 1   | resume para ser encontrado depois                     |
| `episode_builder`     | 1   | estrutura a memória episódica                         |

## Regras compartilhadas

**`UNTRUSTED_CONTENT_RULE`** entra em todos. Declara que o conteúdo entre
`<<<CONTEUDO>>>` e `<<</CONTEUDO>>>` é dado, nunca instrução.

**`FIDELITY_RULE`** entra no Memory Analyst e no Reflection Writer. Proíbe
inventar fatos, lembranças, pessoas, citações, relações e opiniões, e obriga a
declarar a ausência quando a memória não sustenta.

## Saídas estruturadas

Tarefas analíticas usam JSON Schema em modo estrito quando o fornecedor
permite, e o resultado é **sempre** validado por Zod do nosso lado
(`src/ai/schemas/index.ts`). Nunca há parsing frágil de texto livre.

Como o modo estrito exige que toda propriedade esteja em `required`, os schemas
usam `.nullable()` em vez de `.optional()` para campos que podem faltar.

## Separação analista / escritor

É estrutural, não uma convenção. O escritor não pesquisa, não classifica
evidência e não decide conflito — ele recebe o Context Pack pronto. Nunca existe
um "analise minha memória e escreva uma reflexão" numa etapa só.

## Registro no banco

`prompt_versions` guarda nome, versão, finalidade, modelo sugerido, template e
schema. `reflection_versions.prompt_version_id` amarra cada texto ao prompt que
o produziu.
