import { describe, expect, it } from "vitest";
import {
  applySourceDiversity,
  meanReciprocalRank,
  precisionAtK,
  recallAtK,
  reciprocalRankFusion,
  sourceDiversity,
} from "@/services/retrieval/fusion";
import { HeuristicRerankingProvider, hashingEmbedding } from "@/ai/providers/mock";

const cosine = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);

describe("Reciprocal Rank Fusion", () => {
  it("premia o item bem colocado nas duas listas", () => {
    const fused = reciprocalRankFusion({
      vetorial: [
        { id: "a", sourceId: "s1", rank: 1 },
        { id: "b", sourceId: "s2", rank: 2 },
      ],
      textual: [
        { id: "b", sourceId: "s2", rank: 1 },
        { id: "a", sourceId: "s1", rank: 5 },
      ],
    });
    expect(fused[0].id).toBe("b");
    expect(fused[0].ranks).toEqual({ vetorial: 2, textual: 1 });
  });

  it("resgata item que só aparece em uma das buscas", () => {
    const fused = reciprocalRankFusion({
      vetorial: [{ id: "a", sourceId: "s1", rank: 1 }],
      textual: [{ id: "z", sourceId: "s9", rank: 1 }],
    });
    expect(fused.map((f) => f.id).sort()).toEqual(["a", "z"]);
  });

  it("é insensível às escalas de score de cada busca", () => {
    const fused = reciprocalRankFusion({
      vetorial: [
        { id: "a", sourceId: null, rank: 1 },
        { id: "b", sourceId: null, rank: 2 },
        { id: "c", sourceId: null, rank: 3 },
      ],
    });
    expect(fused.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(fused[0].fusionScore).toBeGreaterThan(fused[1].fusionScore);
  });
});

describe("diversidade de fontes", () => {
  it("impede que um livro dominante apague um livro muito relevante", () => {
    const itens = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `A${i}`,
        sourceId: "livroA",
        score: 0.9 - i * 0.001,
      })),
      { id: "B1", sourceId: "livroB", score: 0.7 },
      { id: "B2", sourceId: "livroB", score: 0.68 },
    ];
    const resultado = applySourceDiversity(itens, { limit: 6, maxPerSource: 3 });
    const selecionados = resultado.filter((r) => r.selected);

    expect(selecionados.filter((s) => s.sourceId === "livroA")).toHaveLength(3);
    expect(selecionados.map((s) => s.id)).toContain("B1");
    expect(selecionados.map((s) => s.id)).toContain("B2");
  });

  it("não pune quando existe uma única fonte relevante", () => {
    const itens = Array.from({ length: 6 }, (_, i) => ({
      id: `A${i}`,
      sourceId: "livroA",
      score: 0.9 - i * 0.01,
    }));
    const resultado = applySourceDiversity(itens, { limit: 5, maxPerSource: 3 });
    expect(resultado.filter((r) => r.selected)).toHaveLength(5);
  });

  it("registra o motivo do descarte de cada resultado", () => {
    const itens = [
      { id: "A1", sourceId: "a", score: 0.9 },
      { id: "A2", sourceId: "a", score: 0.8 },
      { id: "B1", sourceId: "b", score: 0.5 },
    ];
    const resultado = applySourceDiversity(itens, { limit: 1, maxPerSource: 1 });
    const descartados = resultado.filter((r) => !r.selected);
    expect(descartados.length).toBe(2);
    for (const item of descartados) expect(item.discardReason).toBeTruthy();
  });
});

describe("métricas de recuperação", () => {
  const relevantes = new Set(["a", "b", "c"]);
  const recuperados = ["x", "a", "b", "y", "c"];

  it("calcula Precision@K", () => {
    expect(precisionAtK(recuperados, relevantes, 3)).toBeCloseTo(2 / 3);
  });

  it("calcula Recall@K", () => {
    expect(recallAtK(recuperados, relevantes, 3)).toBeCloseTo(2 / 3);
    expect(recallAtK(recuperados, relevantes, 5)).toBe(1);
  });

  it("calcula MRR", () => {
    expect(meanReciprocalRank(recuperados, relevantes)).toBeCloseTo(1 / 2);
    expect(meanReciprocalRank(["z"], relevantes)).toBe(0);
  });

  it("mede diversidade de fontes", () => {
    expect(sourceDiversity([{ sourceId: "a" }, { sourceId: "b" }])).toBe(1);
    expect(sourceDiversity([{ sourceId: "a" }, { sourceId: "a" }])).toBe(0.5);
  });
});

describe("embedding do modo demonstração", () => {
  it("aproxima textos que falam do mesmo assunto", () => {
    const consulta = hashingEmbedding("permanecer ao lado de quem sofre", 1536);
    const proximo = hashingEmbedding(
      "ficar ao lado, permanecendo junto de quem está sofrendo",
      1536,
    );
    const distante = hashingEmbedding("receita de bolo de fubá com goiabada", 1536);
    expect(cosine(consulta, proximo)).toBeGreaterThan(cosine(consulta, distante));
  });

  it("é determinístico e normalizado", () => {
    const a = hashingEmbedding("memória", 1536);
    const b = hashingEmbedding("memória", 1536);
    expect(a).toEqual(b);
    expect(cosine(a, a)).toBeCloseTo(1, 6);
  });
});

describe("reranking heurístico", () => {
  it("prioriza autoridade quando a similaridade empata", async () => {
    const provider = new HeuristicRerankingProvider();
    const { value } = await provider.rerank("presença e silêncio", [
      {
        id: "canone",
        text: "A presença é uma forma de silêncio que sustenta.",
        fusionScore: 0.5,
        authorityLevel: 5,
        sourceId: "s1",
      },
      {
        id: "rascunho",
        text: "A presença é uma forma de silêncio que sustenta.",
        fusionScore: 0.5,
        authorityLevel: 1,
        sourceId: "s2",
      },
    ]);
    expect(value[0].id).toBe("canone");
  });

  it("explica cada componente do score", async () => {
    const provider = new HeuristicRerankingProvider();
    const { value } = await provider.rerank("lealdade", [
      {
        id: "x",
        text: "A lealdade permanece.",
        fusionScore: 0.4,
        authorityLevel: 3,
        sourceId: "s",
      },
    ]);
    expect(Object.keys(value[0].reasons).sort()).toEqual([
      "authority",
      "pertinence",
      "recency",
      "similarity",
      "specificity",
    ]);
  });
});
