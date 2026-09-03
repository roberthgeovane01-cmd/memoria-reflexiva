import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery, resolveEmbeddingSpaceId } from "@/services/memory/embeddings";

export type MemoryHit = {
  id: string;
  kind: "chunk" | "claim" | "episode" | "source_summary" | "reflection";
  title: string;
  text: string;
  sourceId: string | null;
  authorityLevel: number | null;
  score: number;
  sectionTitle?: string | null;
  occurredOn?: string | null;
};

export type MemorySearchResult = {
  query: string;
  documents: MemoryHit[];
  passages: MemoryHit[];
  claims: MemoryHit[];
  episodes: MemoryHit[];
  concepts: Array<{
    id: string;
    label: string;
    definition: string | null;
    occurrences: number;
    status: string;
  }>;
  divergences: Array<{
    id: string;
    title: string;
    kind: string;
    severity: string;
    createdAt: string;
  }>;
};

/**
 * A tela de Memória responde a uma pergunta diferente da Biblioteca:
 * não "o que foi colocado", mas "o que o sistema consegue recuperar,
 * relacionar e rastrear".
 */
export async function searchMemory(
  supabase: SupabaseClient,
  input: { workspaceId: string; query: string; limit?: number },
): Promise<MemorySearchResult> {
  const limit = input.limit ?? 8;
  const query = input.query.trim();

  const empty: MemorySearchResult = {
    query,
    documents: [],
    passages: [],
    claims: [],
    episodes: [],
    concepts: [],
    divergences: [],
  };
  if (!query) return empty;

  const spaceId = await resolveEmbeddingSpaceId(supabase);
  const { vector } = await embedQuery(query);

  const search = async (ownerKind: string, take: number) => {
    const { data, error } = await supabase.rpc("mr_hybrid_search", {
      p_workspace_id: input.workspaceId,
      p_query: query,
      p_embedding: vector,
      p_embedding_space_id: spaceId,
      p_owner_kind: ownerKind,
      p_limit: take,
      p_candidates: take * 4,
      p_source_ids: null,
      p_rrf_k: 60,
    });
    if (error) throw error;
    return (data ?? []) as Array<{
      owner_id: string;
      source_id: string | null;
      fusion_score: number;
    }>;
  };

  const [summaryRows, chunkRows, claimRows, episodeRows] = await Promise.all([
    search("source_summary", limit),
    search("chunk", limit * 2),
    search("claim", limit),
    search("episode", limit),
  ]);

  const scoreById = (rows: Array<{ owner_id: string; fusion_score: number }>) =>
    new Map(rows.map((r) => [r.owner_id, r.fusion_score]));

  const documents: MemoryHit[] = [];
  if (summaryRows.length) {
    const scores = scoreById(summaryRows);
    const { data } = await supabase
      .from("source_summaries")
      .select("id, source_id, summary, themes, sources(title, authority_level)")
      .in(
        "id",
        summaryRows.map((r) => r.owner_id),
      );
    for (const row of (data ?? []) as unknown as Array<{
      id: string;
      source_id: string;
      summary: string;
      themes: string[] | null;
      sources: { title: string; authority_level: number } | null;
    }>) {
      documents.push({
        id: row.id,
        kind: "source_summary",
        title: row.sources?.title ?? "Documento",
        text: row.summary,
        sourceId: row.source_id,
        authorityLevel: row.sources?.authority_level ?? null,
        score: scores.get(row.id) ?? 0,
      });
    }
  }

  const passages: MemoryHit[] = [];
  if (chunkRows.length) {
    const scores = scoreById(chunkRows);
    const { data } = await supabase
      .from("source_chunks")
      .select(
        "id, source_id, text, page_start, sources(title, authority_level), source_sections(title)",
      )
      .in(
        "id",
        chunkRows.map((r) => r.owner_id),
      );
    for (const row of (data ?? []) as unknown as Array<{
      id: string;
      source_id: string;
      text: string;
      sources: { title: string; authority_level: number } | null;
      source_sections: { title: string | null } | null;
    }>) {
      passages.push({
        id: row.id,
        kind: "chunk",
        title: row.sources?.title ?? "Documento",
        text: row.text,
        sourceId: row.source_id,
        authorityLevel: row.sources?.authority_level ?? null,
        sectionTitle: row.source_sections?.title ?? null,
        score: scores.get(row.id) ?? 0,
      });
    }
  }

  const claims: MemoryHit[] = [];
  if (claimRows.length) {
    const scores = scoreById(claimRows);
    const { data } = await supabase
      .from("claims")
      .select("id, source_id, text, status, authority_level, sources(title)")
      .in(
        "id",
        claimRows.map((r) => r.owner_id),
      );
    for (const row of (data ?? []) as unknown as Array<{
      id: string;
      source_id: string | null;
      text: string;
      authority_level: number | null;
      sources: { title: string } | null;
    }>) {
      claims.push({
        id: row.id,
        kind: "claim",
        title: row.sources?.title ?? "Afirmação",
        text: row.text,
        sourceId: row.source_id,
        authorityLevel: row.authority_level,
        score: scores.get(row.id) ?? 0,
      });
    }
  }

  const episodes: MemoryHit[] = [];
  if (episodeRows.length) {
    const scores = scoreById(episodeRows);
    const { data } = await supabase
      .from("episodes")
      .select("id, title, summary, narrative, occurred_on")
      .in(
        "id",
        episodeRows.map((r) => r.owner_id),
      );
    for (const row of (data ?? []) as unknown as Array<{
      id: string;
      title: string | null;
      summary: string | null;
      narrative: string;
      occurred_on: string | null;
    }>) {
      episodes.push({
        id: row.id,
        kind: "episode",
        title: row.title ?? "Relato",
        text: row.summary ?? row.narrative,
        sourceId: null,
        authorityLevel: 3,
        occurredOn: row.occurred_on,
        score: scores.get(row.id) ?? 0,
      });
    }
  }

  // Conceitos relacionados (busca textual simples por similaridade de rótulo).
  const { data: conceptRows } = await supabase
    .from("concepts")
    .select("id, label, definition, occurrences, status")
    .eq("workspace_id", input.workspaceId)
    .ilike("label", `%${query.split(/\s+/)[0]}%`)
    .order("occurrences", { ascending: false })
    .limit(10);

  // Divergências já registradas sobre fontes relacionadas.
  const sourceIds = [...new Set([...documents, ...passages, ...claims].map((h) => h.sourceId))]
    .filter((id): id is string => Boolean(id))
    .slice(0, 20);

  const divergences: MemorySearchResult["divergences"] = [];
  if (sourceIds.length) {
    const { data: conflictRows } = await supabase
      .from("conflicts")
      .select("id, title, kind, severity, created_at")
      .eq("workspace_id", input.workspaceId)
      .in("kind", ["source_conflict", "factual_conflict", "interpretive_divergence"])
      .order("created_at", { ascending: false })
      .limit(8);
    for (const row of conflictRows ?? []) {
      divergences.push({
        id: row.id as string,
        title: row.title as string,
        kind: row.kind as string,
        severity: row.severity as string,
        createdAt: row.created_at as string,
      });
    }
  }

  return {
    query,
    documents: documents.sort((a, b) => b.score - a.score),
    passages: passages.sort((a, b) => b.score - a.score).slice(0, limit),
    claims: claims.sort((a, b) => b.score - a.score),
    episodes: episodes.sort((a, b) => b.score - a.score),
    concepts: (conceptRows ?? []) as MemorySearchResult["concepts"],
    divergences,
  };
}
