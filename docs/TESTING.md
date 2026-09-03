# Testes

```bash
npm test          # unitários (46 testes)
npm run typecheck
npm run lint
npm run build
```

## Unitários

**`tests/unit/chunking.test.ts`** — normalização (hifenização, parágrafos,
quebras), hash determinístico, divisão em frases com abreviações, detecção de
estrutura (markdown, hierarquia, documento sem estrutura, ruído de PDF),
chunking (trechos não vazios, dentro da seção, sequência contínua, parágrafo
inteiro preservado, parágrafo gigante quebrado em frase, sobreposição real).

**`tests/unit/fusion.test.ts`** — RRF (item bem colocado nas duas listas, resgate
de item exclusivo de uma busca, insensibilidade a escala), diversidade (livro
dominante x livro pequeno, fonte única não penalizada, motivo de descarte
registrado), métricas (Precision@K, Recall@K, MRR, diversidade), embedding do
modo demonstração (aproxima textos do mesmo assunto, determinístico e
normalizado), reranking (autoridade desempata, componentes explicáveis).

**`tests/unit/investigation.test.ts`** — os testes críticos do produto:

| Teste crítico                    | O que garante                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------- |
| ausência de memória              | declara a ausência, não simula lembrança, não inventa fontes                      |
| conflito fala × memória          | sinaliza divergência de data, nunca diz "você está errado", mostra os dois lados  |
| fontes contraditórias            | registra `source_conflict`, mantém as duas no dossiê                              |
| autoridade não apaga divergência | anotação nível 2 continua citada ao lado de cânone nível 5                        |
| diversidade                      | roda com a distribuição de scores real devolvida pelo banco                       |
| prompt injection                 | conteúdo vai como dado, regra presente, injeção classificada como não relacionada |

## No banco

Executados via SQL contra o projeto real, documentados em
[`SECURITY.md`](SECURITY.md) e [`BRAIN_PROOF.md`](BRAIN_PROOF.md):

- 7 testes de isolamento por RLS entre dois usuários — todos passaram;
- 5 testes de aprovação e voz (TTS bloqueado sem aprovação, hash conferido,
  versão aprovada imutável, histórico preservado) — todos passaram;
- 7 verificações de recuperação sobre o corpus fictício.

## Fluxo ponta a ponta

O cenário completo — criar conta, upload, processamento, indexação, gravação,
transcrição, revisão, investigação, dossiê, conflito, resolução, reflexão,
edição, aprovação, voz, download — está descrito em
[`DEPLOYMENT.md`](DEPLOYMENT.md) como roteiro de smoke test manual.

Automatizá-lo com Playwright exige um projeto Supabase descartável (para não
poluir dados reais) e um usuário de teste com e-mail confirmado. O esqueleto
fica em `tests/e2e/`.

## Limitações conhecidas

1. **Stemmer do modo demonstração.** O radicalizador do hashing vectorizer é
   grosseiro: "sofre" e "sofrendo" viram radicais diferentes. Isso reduz a
   qualidade da busca **vetorial** quando não há chave de IA. A busca textual
   não é afetada (o PostgreSQL usa o stemmer português de verdade), e com
   `OPENAI_API_KEY` configurada o provider mock nem é usado. Ao melhorar o
   tokenizador, **bump a versão do espaço de embedding** e reindexe.
2. **Planner heurístico.** Sem modelo de linguagem, os termos escolhidos são os
   mais frequentes, sem IDF, então palavras pouco informativas aparecem. Com
   chave de IA, o Query Planner real assume.
3. **E2E não automatizado.** Ver acima.
