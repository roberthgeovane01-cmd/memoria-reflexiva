# Sistema de memória

A Biblioteca responde _o que foi colocado_. A Memória responde _o que o sistema
consegue recuperar, relacionar e rastrear_. São coisas diferentes, e por isso
têm telas diferentes.

## As sete camadas

| Camada          | Onde vive                                                                            | O que guarda                                           |
| --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **Documental**  | `sources`, `source_versions`, `source_sections`, `source_summaries`, `source_chunks` | livros, documentos e sua estrutura                     |
| **Semântica**   | `concepts`, `claims`, `claim_evidence`, `claim_relations`                            | conceitos, afirmações e as evidências que as sustentam |
| **Episódica**   | `episodes`                                                                           | acontecimentos relatados nos áudios                    |
| **Autoral**     | reflexões aprovadas devolvidas como `sources` com `origin = 'approved_reflection'`   | o que você mesmo escreveu e aprovou                    |
| **De estilo**   | `style_profiles`, `style_examples`                                                   | como o sistema deve escrever                           |
| **De valores**  | `style_profiles.authorized_values`                                                   | princípios que você autorizou explicitamente           |
| **De feedback** | `conflict_resolutions`, `memories` da camada `feedback`                              | correções, preferências e decisões suas                |

A tabela `memories` é transversal: qualquer camada pode registrar uma memória
com `layer`, `origin`, `status`, `confidence` e temporalidade.

## Aprendizagem controlada

Uma inferência da IA **nunca** vira verdade permanente sozinha. Os estados são:

```
candidate → confirmed → active → corrected → archived → excluded
```

Conceitos e afirmações extraídos automaticamente nascem como `candidate`.
Memórias inferidas nascem com `requires_review = true`. A interface mostra o
estado; só uma ação humana promove.

## Temporalidade

`valid_from`, `valid_until`, `supersedes_id` e `superseded_by_id` existem em
`claims`, `memories` e nas fontes. O sistema precisa conseguir entender que
_você mudou de posição ao longo do tempo_ — não que uma das duas versões é
falsa.

## Autoridade

Escala configurável de 1 a 5:

```
5  cânone ou princípio explicitamente aprovado
4  livro ou texto autoral final
3  reflexão aprovada
2  anotação
1  rascunho
```

**Autoridade não é verdade absoluta.** Ela entra no reranking com peso 0,16 e
influencia a análise, mas _não apaga_ uma divergência: uma anotação de nível 2
que contradiz um cânone de nível 5 continua aparecendo no dossiê como tensão.
Existe um teste automatizado só para isso.

## Rastreabilidade

Uma afirmação é um índice de conhecimento, nunca um substituto do texto. Sempre
é possível voltar:

```
claim → claim_evidence → source_chunks → source_sections → source_versions → sources
```

E, do lado da reflexão:

```
reflection_versions → reflection_sources → source / chunk / claim / episódio
retrieval_hits → scores de cada etapa → o que foi descartado e por quê
```
