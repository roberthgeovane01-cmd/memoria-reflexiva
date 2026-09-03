# Investigação da memória

Quatro responsabilidades **distintas**, nesta ordem, nunca numa chamada só.

## 1. Query Planner

Recebe a transcrição aprovada. Produz saída estruturada validada por Zod:

```json
{
  "central_question": "",
  "intent": "",
  "themes": [],
  "entities": [],
  "claims": [],
  "contrasts": [],
  "temporal_references": [],
  "queries": [{ "text": "", "rationale": "", "level": "global|section|evidence|direct" }]
}
```

Um relato vira de 4 a 10 linhas de pesquisa — sinônimos, o conceito abstrato, a
situação concreta, a tensão oposta. Todas ficam gravadas em
`retrieval_queries`.

O planner **não responde e não escreve**. Ele só planeja.

## 2. Recuperação

Ver [`RAG.md`](RAG.md). Resultado: `retrieval_hits` com todos os scores, o que
foi escolhido e o que foi descartado.

## 3. Evidence Classifier

Para cada evidência recuperada, a relação com a fala atual:

| Classe        | Significado                                  |
| ------------- | -------------------------------------------- |
| `supports`    | sustenta o que foi dito                      |
| `complements` | acrescenta algo compatível, por outro ângulo |
| `contradicts` | afirma algo incompatível                     |
| `qualifies`   | concorda em parte, com ressalva              |
| `unrelated`   | veio por semelhança superficial              |

`unrelated` é tratado com rigor: recuperação por palavra parecida é comum, e
uma evidência irrelevante no dossiê contamina tudo o que vem depois.

## 4. Conflict Analyzer

Ver [`CONFLICT_ENGINE.md`](CONFLICT_ENGINE.md).

## 5. Memory Analyst

Só agora, e ainda **não** é o escritor. Recebe a questão, as evidências
classificadas, as fontes, o contexto temporal, as relações e os conflitos.
Produz o Dossiê — ver [`DOSSIER.md`](DOSSIER.md).

## Estados da sessão

```
draft → awaiting_transcription → transcript_review → investigating
      → needs_conflict_review ⇄ dossier_ready → writing → editing → approved
```

`needs_conflict_review` bloqueia a geração. `dossier_ready` libera.

## Auditoria

A tela "Como a memória chegou aqui?" reconstrói tudo: o que o sistema entendeu,
as consultas executadas, as evidências usadas, o que foi descartado e por quê,
os conflitos com as decisões, e as chamadas de IA com latência, tokens e custo
estimado.
