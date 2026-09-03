import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnalystModel, getRerankingProvider } from "@/ai/providers";
import { QUERY_PLANNER, wrapUntrusted } from "@/ai/prompts";
import { QueryPlanSchema, type QueryPlan } from "@/ai/schemas";
import { stem, tokenize } from "@/ai/providers/mock";
import { recordAudit } from "@/lib/audit";
import { truncate } from "@/lib/utils";
import { splitSentences } from "@/services/ingestion/text";
import { embedQuery, resolveEmbeddingSpaceId } from "@/services/memory/embeddings";
import { applySourceDiversity, reciprocalRankFusion, sourceDiversity } from "./fusion";

export type RetrievalFilters = {
  sourceIds?: string[] | null;
  excludeSourceIds?: string[] | null;
  minAuthority?: number | null;
  kinds?: string[] | null;
  tagIds?: string[] | null;
};

export type RetrievalLimits = {
  globalSources: number;
  sectionsPerQuery: number;
  evidencePerQuery: number;
  finalEvidence: number;
  maxPerSource: number;
  neighborRadius: number;
};

export const DEFAULT_LIMITS: RetrievalLimits = {
  globalSources: 8,
  sectionsPerQuery: 12,
  evidencePerQuery: 24,
  finalEvidence: 18,
  maxPerSource: 4,
  neighborRadius: 1,
};

export type EvidenceItem = {
  /** id do registro em retrieval_hits — é este identificador que a IA cita. */
  hitId: string;
  ownerKind: "chunk" | "claim" | "episode" | "reflection" | "section_summary" | "source_summary";
  ownerId: string;
  sourceId: string | null;
  sourceTitle: string;
  authorityLevel: number;
  sectionTitle: string | null;
  headingPath: string[];
  pageStart: number | null;
  pageEnd: number | null;
  text: string;
  /** Trecho anterior + trecho + trecho seguinte, quando aplicável. */
  contextText: string;
  scores: {
    vector: number | null;
    fulltext: number | null;
    fusion: number;
    rerank: number;
    final: number;
  };
  occurredAt: string | null;
};

export type RetrievalResult = {
  retrievalSessionId: string;
  plan: QueryPlan;
  selected: EvidenceItem[];
  discarded: Array<{ hitId: string; ownerId: string; reason: string; score: number }>;
  stats: {
    candidateSources: number;
    consideredEvidence: number;
    selectedEvidence: number;
    diversity: number;
    queries: number;
    demo: boolean;
  };
};

type HybridRow = {
  owner_id: string;
  source_id: string | null;
  vector_score: number | null;
  fulltext_score: number | null;
  fusion_score: number;
  vector_rank: number | null;
  fulltext_rank: number | null;
};

/**
 * INVESTIGAÇÃO DA MEMÓRIA.
 *
 *   Nível global      → quais livros podem ter relação com o assunto?
 *   Nível intermediário → onde, nesses livros, o assunto aparece?
 *   Nível evidência   → qual é a evidência concreta?
 *   Busca direta      → em paralelo, varre os trechos de TODA a biblioteca,
 *                       para que nada relevante fique fora só porque o resumo
 *                       do livro não mencionou o tema.
 *
 * Tudo é persistido: consultas, resultados, scores, o que foi escolhido e o
 * que foi descartado — e por quê.
 */
export async function runRetrieval(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string | null;
    inputText: string;
    reflectionSessionId?: string | null;
    transcriptId?: string | null;
    filters?: RetrievalFilters;
    limits?: Partial<RetrievalLimits>;
  },
): Promise<RetrievalResult> {
  const limits = { ...DEFAULT_LIMITS, ...(input.limits ?? {}) };
  const filters = input.filters ?? {};
  const embeddingSpaceId = await resolveEmbeddingSpaceId(supabase);
  const reranker = getRerankingProvider();

  // ---- Sessão de investigação --------------------------------------------
  const { data: session, error: sessionError } = await supabase
    .from("retrieval_sessions")
    .insert({
      workspace_id: input.workspaceId,
      reflection_session_id: input.reflectionSessionId ?? null,
      transcript_id: input.transcriptId ?? null,
      input_text: input.inputText,
      filters: filters as unknown as Record<string, unknown>,
      embedding_space_id: embeddingSpaceId,
      reranker: reranker.name,
      parameters: limits as unknown as Record<string, unknown>,
      status: "planning",
      started_at: new Date().toISOString(),
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (sessionError) throw sessionError;
  const retrievalSessionId = session.id as string;

  try {
    // ---- 1. Query Planner -------------------------------------------------
    const { plan, demo } = await buildQueryPlan(supabase, input.workspaceId, input.inputText);

    await supabase
      .from("retrieval_sessions")
      .update({
        central_question: plan.central_question,
        intent: plan.intent,
        plan: plan as unknown as Record<string, unknown>,
        planner_model: demo ? "heuristic-demo" : undefined,
        status: "searching",
      })
      .eq("id", retrievalSessionId);

    const queryRows = plan.queries.map((q, index) => ({
      workspace_id: input.workspaceId,
      retrieval_session_id: retrievalSessionId,
      sequence: index,
      text: q.text,
      rationale: q.rationale,
      level: q.level,
      strategy: "hybrid" as const,
      created_by: input.userId,
    }));
    const { data: storedQueries, error: queryError } = await supabase
      .from("retrieval_queries")
      .insert(queryRows)
      .select("id, sequence, text, level");
    if (queryError) throw queryError;
    const queries = (storedQueries as Array<{
      id: string;
      sequence: number;
      text: string;
      level: string;
    }>).sort((a, b) => a.sequence - b.sequence);

    // Vetores das consultas (uma chamada de embedding por consulta).
    const embeddings = new Map<string, string>();
    for (const query of queries) {
      const { vector } = await embedQuery(query.text);
      embeddings.set(query.id, vector);
    }

    const baseSourceIds = await resolveSourceFilter(supabase, input.workspaceId, filters);

    // ---- 2. Nível global: quais livros participam? ------------------------
    const globalLists: Record<string, Array<{ id: string; sourceId: string | null; rank: number }>> =
      {};
    for (const query of queries) {
      const rows = await hybrid(supabase, {
        workspaceId: input.workspaceId,
        query: query.text,
        embedding: embeddings.get(query.id)!,
        embeddingSpaceId,
        ownerKind: "source_summary",
        limit: limits.globalSources * 3,
        sourceIds: baseSourceIds,
      });
      globalLists[`global:${query.sequence}`] = rows.map((r, i) => ({
        id: r.source_id ?? r.owner_id,
        sourceId: r.source_id,
        rank: i + 1,
      }));
    }

    const fusedSources = reciprocalRankFusion(globalLists);
    const candidateSourceIds = fusedSources
      .map((s) => s.sourceId)
      .filter((id): id is string => Boolean(id))
      .slice(0, limits.globalSources);

    // ---- 3. Nível intermediário: onde, dentro desses livros? --------------
    const sectionLists: Record<string, Array<{ id: string; sourceId: string | null; rank: number }>> =
      {};
    for (const query of queries) {
      const rows = await hybrid(supabase, {
        workspaceId: input.workspaceId,
        query: query.text,
        embedding: embeddings.get(query.id)!,
        embeddingSpaceId,
        ownerKind: "section_summary",
        limit: limits.sectionsPerQuery,
        sourceIds: candidateSourceIds.length ? candidateSourceIds : baseSourceIds,
      });
      sectionLists[`section:${query.sequence}`] = rows.map((r, i) => ({
        id: r.owner_id,
        sourceId: r.source_id,
        rank: i + 1,
      }));
    }
    const fusedSections = reciprocalRankFusion(sectionLists);
    const sectionIds = fusedSections.slice(0, limits.sectionsPerQuery * 2).map((s) => s.id);

    // ---- 4. Nível evidência + busca direta em paralelo --------------------
    const evidenceLists: Record<
      string,
      Array<{ id: string; sourceId: string | null; rank: number }>
    > = {};
    const rawScores = new Map<string, HybridRow>();
    const ownerKindById = new Map<string, EvidenceItem["ownerKind"]>();

    const collect = (
      key: string,
      rows: HybridRow[],
      ownerKind: EvidenceItem["ownerKind"],
    ) => {
      evidenceLists[key] = rows.map((r, i) => ({
        id: r.owner_id,
        sourceId: r.source_id,
        rank: i + 1,
      }));
      for (const row of rows) {
        ownerKindById.set(row.owner_id, ownerKind);
        const previous = rawScores.get(row.owner_id);
        if (!previous || row.fusion_score > previous.fusion_score) rawScores.set(row.owner_id, row);
      }
    };

    for (const query of queries) {
      const embedding = embeddings.get(query.id)!;

      // dentro dos livros selecionados pela busca hierárquica
      if (candidateSourceIds.length) {
        collect(
          `evidence:${query.sequence}`,
          await hybrid(supabase, {
            workspaceId: input.workspaceId,
            query: query.text,
            embedding,
            embeddingSpaceId,
            ownerKind: "chunk",
            limit: limits.evidencePerQuery,
            sourceIds: candidateSourceIds,
          }),
          "chunk",
        );
      }

      // busca direta: TODA a biblioteca, sem passar pelo funil hierárquico
      collect(
        `direct:${query.sequence}`,
        await hybrid(supabase, {
          workspaceId: input.workspaceId,
          query: query.text,
          embedding,
          embeddingSpaceId,
          ownerKind: "chunk",
          limit: limits.evidencePerQuery,
          sourceIds: baseSourceIds,
        }),
        "chunk",
      );

      collect(
        `claims:${query.sequence}`,
        await hybrid(supabase, {
          workspaceId: input.workspaceId,
          query: query.text,
          embedding,
          embeddingSpaceId,
          ownerKind: "claim",
          limit: 10,
          sourceIds: baseSourceIds,
        }),
        "claim",
      );

      collect(
        `episodes:${query.sequence}`,
        await hybrid(supabase, {
          workspaceId: input.workspaceId,
          query: query.text,
          embedding,
          embeddingSpaceId,
          ownerKind: "episode",
          limit: 6,
          sourceIds: null,
        }),
        "episode",
      );
    }

    // Trechos que estão em seções bem ranqueadas ganham um empurrão.
    const sectionBoost = new Set(sectionIds);
    const fusedEvidence = reciprocalRankFusion(evidenceLists, {
      weights: {
        ...Object.fromEntries(queries.map((q) => [`evidence:${q.sequence}`, 1.15])),
        ...Object.fromEntries(queries.map((q) => [`direct:${q.sequence}`, 1])),
        ...Object.fromEntries(queries.map((q) => [`claims:${q.sequence}`, 0.9])),
        ...Object.fromEntries(queries.map((q) => [`episodes:${q.sequence}`, 0.9])),
      },
    });

    await supabase
      .from("retrieval_sessions")
      .update({ status: "ranking" })
      .eq("id", retrievalSessionId);

    // ---- 5. Materializa os candidatos ------------------------------------
    const candidates = await loadCandidates(supabase, {
      workspaceId: input.workspaceId,
      ids: fusedEvidence.slice(0, 120).map((f) => f.id),
      ownerKindById,
      sectionBoost,
    });

    // ---- 6. Reranking ----------------------------------------------------
    const { value: reranked, usage: rerankUsage } = await reranker.rerank(
      plan.central_question,
      candidates.map((c) => ({
        id: c.ownerId,
        text: c.text,
        fusionScore: fusedEvidence.find((f) => f.id === c.ownerId)?.fusionScore ?? 0,
        authorityLevel: c.authorityLevel,
        sourceId: c.sourceId,
        occurredAt: c.occurredAt,
      })),
    );
    const rerankById = new Map(reranked.map((r) => [r.id, r]));

    // ---- 7. Diversidade e seleção ----------------------------------------
    const diversity = applySourceDiversity(
      candidates.map((c) => ({
        id: c.ownerId,
        sourceId: c.sourceId,
        score: rerankById.get(c.ownerId)?.score ?? 0,
      })),
      { limit: limits.finalEvidence, maxPerSource: limits.maxPerSource },
    );
    const diversityById = new Map(diversity.map((d) => [d.id, d]));

    // ---- 8. Persistência de TODOS os resultados --------------------------
    const hitRows = candidates.map((candidate) => {
      const raw = rawScores.get(candidate.ownerId);
      const rerank = rerankById.get(candidate.ownerId);
      const div = diversityById.get(candidate.ownerId);
      const fusion = fusedEvidence.find((f) => f.id === candidate.ownerId);
      return {
        workspace_id: input.workspaceId,
        retrieval_session_id: retrievalSessionId,
        level: sectionBoost.has(candidate.sectionId ?? "") ? "section" : "evidence",
        owner_kind: candidate.ownerKind,
        owner_id: candidate.ownerId,
        source_id: candidate.sourceId,
        section_id: candidate.sectionId,
        chunk_id: candidate.ownerKind === "chunk" ? candidate.ownerId : null,
        claim_id: candidate.ownerKind === "claim" ? candidate.ownerId : null,
        vector_score: raw?.vector_score ?? null,
        fulltext_score: raw?.fulltext_score ?? null,
        fusion_score: fusion?.fusionScore ?? 0,
        rerank_score: rerank?.score ?? 0,
        final_score: div?.adjustedScore ?? rerank?.score ?? 0,
        authority_level: candidate.authorityLevel,
        diversity_penalty: div?.penalty ?? 0,
        selected: div?.selected ?? false,
        discard_reason: div?.selected ? null : (div?.discardReason ?? "não selecionado"),
        snippet: truncate(candidate.text, 400),
        explanation: {
          ranks: fusion?.ranks ?? {},
          rerank_reasons: rerank?.reasons ?? {},
          in_boosted_section: sectionBoost.has(candidate.sectionId ?? ""),
        },
        created_by: input.userId,
      };
    });

    const storedHits: Array<{ id: string; owner_id: string; selected: boolean }> = [];
    for (let i = 0; i < hitRows.length; i += 100) {
      const { data, error } = await supabase
        .from("retrieval_hits")
        .insert(hitRows.slice(i, i + 100))
        .select("id, owner_id, selected");
      if (error) throw error;
      storedHits.push(...(data as typeof storedHits));
    }
    const hitIdByOwner = new Map(storedHits.map((h) => [h.owner_id, h.id]));

    // ---- 9. Vizinhança dos trechos escolhidos ----------------------------
    const selectedCandidates = candidates
      .filter((c) => diversityById.get(c.ownerId)?.selected)
      .sort(
        (a, b) =>
          (diversityById.get(b.ownerId)?.adjustedScore ?? 0) -
          (diversityById.get(a.ownerId)?.adjustedScore ?? 0),
      );

    const selected: EvidenceItem[] = [];
    for (const candidate of selectedCandidates) {
      const contextText =
        candidate.ownerKind === "chunk" && limits.neighborRadius > 0
          ? await expandNeighborhood(supabase, candidate.ownerId, limits.neighborRadius)
          : candidate.text;

      const rerank = rerankById.get(candidate.ownerId);
      const div = diversityById.get(candidate.ownerId);
      const raw = rawScores.get(candidate.ownerId);
      const fusion = fusedEvidence.find((f) => f.id === candidate.ownerId);

      selected.push({
        hitId: hitIdByOwner.get(candidate.ownerId)!,
        ownerKind: candidate.ownerKind,
        ownerId: candidate.ownerId,
        sourceId: candidate.sourceId,
        sourceTitle: candidate.sourceTitle,
        authorityLevel: candidate.authorityLevel,
        sectionTitle: candidate.sectionTitle,
        headingPath: candidate.headingPath,
        pageStart: candidate.pageStart,
        pageEnd: candidate.pageEnd,
        text: candidate.text,
        contextText,
        scores: {
          vector: raw?.vector_score ?? null,
          fulltext: raw?.fulltext_score ?? null,
          fusion: fusion?.fusionScore ?? 0,
          rerank: rerank?.score ?? 0,
          final: div?.adjustedScore ?? 0,
        },
        occurredAt: candidate.occurredAt,
      });
    }

    const discarded = candidates
      .filter((c) => !diversityById.get(c.ownerId)?.selected)
      .map((c) => ({
        hitId: hitIdByOwner.get(c.ownerId)!,
        ownerId: c.ownerId,
        reason: diversityById.get(c.ownerId)?.discardReason ?? "não selecionado",
        score: diversityById.get(c.ownerId)?.adjustedScore ?? 0,
      }));

    const stats = {
      candidateSources: candidateSourceIds.length,
      consideredEvidence: candidates.length,
      selectedEvidence: selected.length,
      diversity: sourceDiversity(selected),
      queries: queries.length,
      demo,
    };

    await supabase
      .from("retrieval_sessions")
      .update({ status: "completed", finished_at: new Date().toISOString(), stats })
      .eq("id", retrievalSessionId);

    await recordAudit(supabase, {
      workspaceId: input.workspaceId,
      actorId: input.userId,
      actorKind: "ai",
      action: "retrieval",
      entityKind: "retrieval_session",
      entityId: retrievalSessionId,
      usage: rerankUsage,
      metadata: stats,
    });

    return { retrievalSessionId, plan, selected, discarded, stats };
  } catch (error) {
    await supabase
      .from("retrieval_sessions")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
        finished_at: new Date().toISOString(),
      })
      .eq("id", retrievalSessionId);
    throw error;
  }
}

// --------------------------------------------------------------------------

async function hybrid(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    query: string;
    embedding: string;
    embeddingSpaceId: string;
    ownerKind: string;
    limit: number;
    sourceIds: string[] | null;
  },
): Promise<HybridRow[]> {
  const { data, error } = await supabase.rpc("mr_hybrid_search", {
    p_workspace_id: input.workspaceId,
    p_query: input.query,
    p_embedding: input.embedding,
    p_embedding_space_id: input.embeddingSpaceId,
    p_owner_kind: input.ownerKind,
    p_limit: input.limit,
    p_candidates: Math.max(input.limit * 3, 40),
    p_source_ids: input.sourceIds,
    p_rrf_k: 60,
  });
  if (error) throw error;
  return (data ?? []) as HybridRow[];
}

async function resolveSourceFilter(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: RetrievalFilters,
): Promise<string[] | null> {
  let query = supabase
    .from("sources")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .eq("status", "ready");

  if (filters.sourceIds?.length) query = query.in("id", filters.sourceIds);
  if (filters.excludeSourceIds?.length)
    query = query.not("id", "in", `(${filters.excludeSourceIds.join(",")})`);
  if (filters.minAuthority) query = query.gte("authority_level", filters.minAuthority);
  if (filters.kinds?.length) query = query.in("kind", filters.kinds);

  const { data, error } = await query;
  if (error) throw error;

  let ids = (data ?? []).map((row) => row.id as string);

  if (filters.tagIds?.length) {
    const { data: tagged, error: tagError } = await supabase
      .from("source_tags")
      .select("source_id")
      .in("tag_id", filters.tagIds);
    if (tagError) throw tagError;
    const allowed = new Set((tagged ?? []).map((t) => t.source_id as string));
    ids = ids.filter((id) => allowed.has(id));
  }

  return ids.length ? ids : null;
}

type Candidate = {
  ownerKind: EvidenceItem["ownerKind"];
  ownerId: string;
  sourceId: string | null;
  sourceTitle: string;
  authorityLevel: number;
  sectionId: string | null;
  sectionTitle: string | null;
  headingPath: string[];
  pageStart: number | null;
  pageEnd: number | null;
  text: string;
  occurredAt: string | null;
};

async function loadCandidates(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    ids: string[];
    ownerKindById: Map<string, EvidenceItem["ownerKind"]>;
    sectionBoost: Set<string>;
  },
): Promise<Candidate[]> {
  const chunkIds = input.ids.filter((id) => input.ownerKindById.get(id) === "chunk");
  const claimIds = input.ids.filter((id) => input.ownerKindById.get(id) === "claim");
  const episodeIds = input.ids.filter((id) => input.ownerKindById.get(id) === "episode");
  const out: Candidate[] = [];

  if (chunkIds.length) {
    type ChunkRow = {
      id: string;
      source_id: string;
      section_id: string | null;
      text: string;
      heading_path: string[] | null;
      page_start: number | null;
      page_end: number | null;
      created_at: string | null;
      sources: { title: string; authority_level: number } | null;
      source_sections: { title: string | null } | null;
    };

    const { data, error } = await supabase
      .from("source_chunks")
      .select(
        "id, source_id, section_id, text, heading_path, page_start, page_end, created_at, " +
          "sources(title, authority_level), source_sections(title)",
      )
      .in("id", chunkIds);
    if (error) throw error;

    for (const row of (data ?? []) as unknown as ChunkRow[]) {
      out.push({
        ownerKind: "chunk",
        ownerId: row.id,
        sourceId: row.source_id,
        sourceTitle: row.sources?.title ?? "Documento",
        authorityLevel: row.sources?.authority_level ?? 3,
        sectionId: row.section_id,
        sectionTitle: row.source_sections?.title ?? null,
        headingPath: row.heading_path ?? [],
        pageStart: row.page_start,
        pageEnd: row.page_end,
        text: row.text,
        occurredAt: row.created_at,
      });
    }
  }

  if (claimIds.length) {
    type ClaimRow = {
      id: string;
      source_id: string | null;
      text: string;
      authority_level: number | null;
      created_at: string | null;
      valid_from: string | null;
      sources: { title: string; authority_level: number } | null;
    };

    const { data, error } = await supabase
      .from("claims")
      .select(
        "id, source_id, text, authority_level, created_at, valid_from, " +
          "sources(title, authority_level)",
      )
      .in("id", claimIds);
    if (error) throw error;

    for (const row of (data ?? []) as unknown as ClaimRow[]) {
      out.push({
        ownerKind: "claim",
        ownerId: row.id,
        sourceId: row.source_id,
        sourceTitle: row.sources?.title ?? "Afirmação",
        authorityLevel: row.authority_level ?? row.sources?.authority_level ?? 3,
        sectionId: null,
        sectionTitle: null,
        headingPath: [],
        pageStart: null,
        pageEnd: null,
        text: row.text,
        occurredAt: row.valid_from ?? row.created_at,
      });
    }
  }

  if (episodeIds.length) {
    type EpisodeRow = {
      id: string;
      title: string | null;
      narrative: string;
      summary: string | null;
      occurred_on: string | null;
      created_at: string | null;
    };

    const { data, error } = await supabase
      .from("episodes")
      .select("id, title, narrative, summary, occurred_on, created_at")
      .in("id", episodeIds);
    if (error) throw error;

    for (const row of (data ?? []) as unknown as EpisodeRow[]) {
      out.push({
        ownerKind: "episode",
        ownerId: row.id,
        sourceId: null,
        sourceTitle: `Relato: ${row.title ?? "sem título"}`,
        // Relatos do próprio usuário entram como memória episódica (nível 3).
        authorityLevel: 3,
        sectionId: null,
        sectionTitle: null,
        headingPath: [],
        pageStart: null,
        pageEnd: null,
        text: row.summary || row.narrative,
        occurredAt: row.occurred_on ?? row.created_at,
      });
    }
  }

  return out;
}

/** Trecho anterior + trecho + trecho seguinte. */
async function expandNeighborhood(
  supabase: SupabaseClient,
  chunkId: string,
  radius: number,
): Promise<string> {
  const { data, error } = await supabase.rpc("mr_chunk_window", {
    p_chunk_id: chunkId,
    p_radius: radius,
  });
  if (error || !data) return "";
  return (data as Array<{ text: string; is_center: boolean }>)
    .map((row) => (row.is_center ? row.text : `[…] ${row.text}`))
    .join("\n\n");
}

// --------------------------------------------------------------------------

async function buildQueryPlan(
  supabase: SupabaseClient,
  workspaceId: string,
  inputText: string,
): Promise<{ plan: QueryPlan; demo: boolean }> {
  const model = getAnalystModel();
  const { value, usage } = await model.generateStructured({
    promptName: QUERY_PLANNER.name,
    promptVersion: QUERY_PLANNER.version,
    system: QUERY_PLANNER.system,
    user: wrapUntrusted("Fala transcrita e revisada pela pessoa", inputText),
    schema: QueryPlanSchema,
    schemaName: QUERY_PLANNER.schemaName!,
    maxOutputTokens: 2500,
    demoFallback: () => heuristicQueryPlan(inputText),
  });

  await recordAudit(supabase, {
    workspaceId,
    actorKind: "ai",
    action: "query_plan",
    usage,
    metadata: { queries: value.queries.length },
  });

  return { plan: value, demo: usage.demo };
}

/**
 * Plano de investigação sem modelo de linguagem.
 *
 * Não é um plano vazio: gera consultas reais a partir dos termos mais
 * característicos da fala, das frases mais densas e de combinações entre os
 * termos — o suficiente para a busca híbrida funcionar em modo demonstração.
 */
export function heuristicQueryPlan(inputText: string): QueryPlan {
  const sentences = splitSentences(inputText);
  const frequency = new Map<string, { count: number; sample: string }>();
  for (const token of tokenize(inputText)) {
    const key = stem(token);
    const current = frequency.get(key);
    if (current) current.count += 1;
    else frequency.set(key, { count: 1, sample: token });
  }

  const terms = [...frequency.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([, v]) => v.sample);

  const central =
    sentences.find((s) => s.length > 40) ?? sentences[0] ?? inputText.slice(0, 200);

  const queries: QueryPlan["queries"] = [
    { text: central, rationale: "A fala como foi dita", level: "direct" as const },
    { text: terms.slice(0, 4).join(" "), rationale: "Termos centrais", level: "global" as const },
  ];

  for (const [i, term] of terms.slice(0, 4).entries()) {
    const pair = terms[(i + 1) % Math.max(terms.length, 1)];
    queries.push({
      text: pair && pair !== term ? `${term} ${pair}` : term,
      rationale: `Combinação em torno de "${term}"`,
      level: i % 2 === 0 ? "evidence" : "section",
    });
  }

  const longest = [...sentences].sort((a, b) => b.length - a.length).slice(0, 2);
  for (const sentence of longest) {
    if (sentence !== central) {
      queries.push({
        text: sentence,
        rationale: "Frase densa do relato",
        level: "evidence" as const,
      });
    }
  }

  return {
    central_question: central,
    intent: "compreender",
    themes: terms,
    entities: [],
    claims: sentences.slice(0, 3),
    contrasts: [],
    temporal_references: [],
    queries: queries.slice(0, 10),
  };
}
