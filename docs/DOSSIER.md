# Dossiê de memória

O Dossiê é um **documento de trabalho para o escritor**. Não é literatura, não
imita estilo e não conversa com o usuário.

## Estrutura

```json
{
  "central_question": "",
  "executive_summary": "",
  "has_memory": true,
  "convergences": [],
  "complements": [],
  "tensions": [],
  "contradictions": [],
  "temporal_evolution": [],
  "related_episodes": [],
  "knowledge_gaps": [],
  "central_sources": [],
  "editorial_notes": []
}
```

Cada achado em `convergences`, `complements`, `tensions` e `contradictions`
carrega `evidence_ids` e `source_ids`. Sem isso, o achado é removido.

## Rastreabilidade

`sanitizeDossier` roda antes de gravar: remove qualquer achado que cite
identificador inexistente. Se **todos** os achados forem removidos,
`has_memory` vira `false` e o resumo executivo é substituído pela declaração de
ausência. Não existe síntese importante sem saber de onde veio.

Cada achado também vira linhas em `dossier_evidence`, ligando conclusão →
`retrieval_hit` → fonte / trecho / afirmação / episódio, com a citação e a
classificação.

## Ausência de memória é um resultado

Quando a biblioteca não cobre o assunto, `has_memory = false`, as listas ficam
vazias e o resumo diz isso com todas as letras. A interface mostra um aviso, e
o escritor recebe a instrução de declarar a lacuna em vez de simular lembrança.

## Métricas gravadas

- `coverage_score` — proporção das evidências recuperadas que o dossiê citou
- `diversity_score` — diversidade de fontes entre as evidências selecionadas

## Rubrica de avaliação

Relevância, fidelidade, cobertura, diversidade, rastreabilidade, detecção de
conflitos e qualidade de síntese. Avaliadas **separadamente da prosa** da
reflexão final.
