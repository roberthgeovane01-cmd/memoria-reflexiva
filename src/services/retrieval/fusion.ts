/**
 * Fusão, diversidade e seleção — o coração do ranking.
 *
 * Tudo aqui é função pura, sem banco e sem rede, justamente para poder ser
 * testado com precisão. As decisões de ranking do aplicativo são auditáveis
 * porque nascem destas funções.
 */

export type RankedItem = {
  id: string;
  sourceId: string | null;
  rank: number;
};

export type FusedItem = {
  id: string;
  sourceId: string | null;
  fusionScore: number;
  /** Posição em cada lista de origem, para auditoria. */
  ranks: Record<string, number>;
};

/**
 * Reciprocal Rank Fusion.
 *
 * score(d) = Σ_listas 1 / (k + rank(d))
 *
 * É o método padrão para combinar buscas heterogêneas (vetorial e textual)
 * sem precisar normalizar escalas de score incompatíveis entre si.
 */
export function reciprocalRankFusion(
  lists: Record<string, RankedItem[]>,
  options: { k?: number; weights?: Record<string, number> } = {},
): FusedItem[] {
  const k = options.k ?? 60;
  const weights = options.weights ?? {};
  const accumulator = new Map<string, FusedItem>();

  for (const [listName, items] of Object.entries(lists)) {
    const weight = weights[listName] ?? 1;
    items.forEach((item, index) => {
      const rank = item.rank > 0 ? item.rank : index + 1;
      const current = accumulator.get(item.id) ?? {
        id: item.id,
        sourceId: item.sourceId,
        fusionScore: 0,
        ranks: {},
      };
      current.fusionScore += weight * (1 / (k + rank));
      current.ranks[listName] = rank;
      if (!current.sourceId && item.sourceId) current.sourceId = item.sourceId;
      accumulator.set(item.id, current);
    });
  }

  return [...accumulator.values()].sort((a, b) => b.fusionScore - a.fusionScore);
}

// --------------------------------------------------------------------------

export type DiversityInput = {
  id: string;
  sourceId: string | null;
  score: number;
};

export type DiversityOutput = {
  id: string;
  sourceId: string | null;
  score: number;
  adjustedScore: number;
  penalty: number;
  selected: boolean;
  discardReason: string | null;
};

/**
 * Diversidade de fontes.
 *
 * Problema real: um livro com 100 trechos parecidos não pode apagar um livro
 * com 2 trechos muito relevantes. A cada novo trecho da MESMA fonte aplicamos
 * uma penalidade crescente, e existe um teto rígido por fonte enquanto houver
 * outras fontes candidatas.
 *
 * A penalidade nunca zera um resultado excelente: se uma fonte é a única que
 * fala do assunto, ela ocupa as vagas — o limite só age quando há alternativa.
 */
export function applySourceDiversity(
  items: DiversityInput[],
  options: {
    limit: number;
    maxPerSource?: number;
    decay?: number;
    minSources?: number;
  },
): DiversityOutput[] {
  const maxPerSource = options.maxPerSource ?? 3;
  const decay = options.decay ?? 0.35;
  const minSources = options.minSources ?? 2;

  const ordered = [...items].sort((a, b) => b.score - a.score);
  const distinctSources = new Set(ordered.map((i) => i.sourceId ?? i.id)).size;
  const enforceCap = distinctSources >= minSources;

  const perSource = new Map<string, number>();
  const scored: DiversityOutput[] = ordered.map((item) => {
    const key = item.sourceId ?? `__solo:${item.id}`;
    const seen = perSource.get(key) ?? 0;
    perSource.set(key, seen + 1);

    const penalty = seen === 0 ? 0 : 1 - Math.pow(1 - decay, seen);
    const overCap = enforceCap && seen >= maxPerSource;

    return {
      id: item.id,
      sourceId: item.sourceId,
      score: item.score,
      adjustedScore: item.score * (1 - penalty),
      penalty,
      selected: false,
      discardReason: overCap ? "limite por fonte (diversidade)" : null,
    };
  });

  // Primeiro preenche com quem está dentro do limite por fonte.
  const eligible = scored
    .filter((i) => i.discardReason === null)
    .sort((a, b) => b.adjustedScore - a.adjustedScore);

  const selected = new Set(eligible.slice(0, options.limit).map((i) => i.id));

  // O teto por fonte é uma preferência, não um desperdício: se sobraram vagas,
  // elas são preenchidas pelos melhores candidatos que estouraram o teto — já
  // penalizados. Melhor um trecho a mais da mesma fonte do que uma vaga vazia.
  if (selected.size < options.limit) {
    const overflow = scored
      .filter((i) => !selected.has(i.id))
      .sort((a, b) => b.adjustedScore - a.adjustedScore);
    for (const item of overflow) {
      if (selected.size >= options.limit) break;
      selected.add(item.id);
    }
  }

  return scored
    .map((item) => ({
      ...item,
      selected: selected.has(item.id),
      discardReason: selected.has(item.id)
        ? null
        : (item.discardReason ?? "fora do limite de resultados"),
    }))
    .sort((a, b) => b.adjustedScore - a.adjustedScore);
}

// --------------------------------------------------------------------------

/**
 * Métricas de avaliação do retrieval, avaliadas separadamente da prosa.
 * "Não julgue o sistema somente pela escrita."
 */
export function precisionAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  const top = retrieved.slice(0, k);
  if (top.length === 0) return 0;
  return top.filter((id) => relevant.has(id)).length / top.length;
}

export function recallAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 1;
  const top = new Set(retrieved.slice(0, k));
  let hits = 0;
  for (const id of relevant) if (top.has(id)) hits += 1;
  return hits / relevant.size;
}

export function meanReciprocalRank(retrieved: string[], relevant: Set<string>): number {
  for (let i = 0; i < retrieved.length; i += 1) {
    if (relevant.has(retrieved[i])) return 1 / (i + 1);
  }
  return 0;
}

export function sourceDiversity(items: Array<{ sourceId: string | null }>): number {
  if (items.length === 0) return 0;
  const sources = new Set(items.map((i) => i.sourceId ?? "desconhecida"));
  return sources.size / items.length;
}
