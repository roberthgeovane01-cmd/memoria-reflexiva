import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbeddingProvider } from "@/ai/providers";
import type { ProviderUsage } from "@/ai/providers/types";

export type OwnerKind =
  | "source_summary"
  | "section_summary"
  | "chunk"
  | "claim"
  | "concept"
  | "episode"
  | "reflection";

export type EmbeddingTarget = {
  ownerKind: OwnerKind;
  ownerId: string;
  sourceId: string | null;
  text: string;
};

/**
 * Resolve o "espaço de embedding" ativo — provider + modelo + dimensões.
 * Vetores de espaços diferentes nunca são comparados; é por isso que o espaço
 * é uma linha no banco e não uma string solta no código.
 */
export async function resolveEmbeddingSpaceId(supabase: SupabaseClient): Promise<string> {
  const provider = getEmbeddingProvider();

  const { data: existing, error } = await supabase
    .from("embedding_spaces")
    .select("id")
    .eq("provider", provider.name)
    .eq("model", provider.model)
    .eq("dimensions", provider.dimensions)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (existing) return existing.id as string;

  const { data: created, error: insertError } = await supabase
    .from("embedding_spaces")
    .insert({
      provider: provider.name,
      model: provider.model,
      dimensions: provider.dimensions,
      version: 1,
      is_active: true,
    })
    .select("id")
    .single();

  if (insertError) throw insertError;
  return created.id as string;
}

/** Gera e grava embeddings, ignorando alvos que já possuem vetor no espaço. */
export async function embedTargets(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    targets: EmbeddingTarget[];
    embeddingSpaceId?: string;
    batchSize?: number;
  },
): Promise<{ inserted: number; usage: ProviderUsage[] }> {
  if (input.targets.length === 0) return { inserted: 0, usage: [] };

  const provider = getEmbeddingProvider();
  const spaceId = input.embeddingSpaceId ?? (await resolveEmbeddingSpaceId(supabase));
  const batchSize = input.batchSize ?? 64;

  const usage: ProviderUsage[] = [];
  let inserted = 0;

  for (let i = 0; i < input.targets.length; i += batchSize) {
    const batch = input.targets.slice(i, i + batchSize);
    const result = await provider.embed(batch.map((t) => t.text));
    usage.push(result.usage);

    const rows = batch.map((target, index) => ({
      workspace_id: input.workspaceId,
      embedding_space_id: spaceId,
      owner_kind: target.ownerKind,
      owner_id: target.ownerId,
      source_id: target.sourceId,
      embedding: JSON.stringify(result.value[index]),
    }));

    const { error } = await supabase
      .from("embeddings")
      .upsert(rows, { onConflict: "owner_kind,owner_id,embedding_space_id" });

    if (error) throw error;
    inserted += rows.length;
  }

  return { inserted, usage };
}

/** Embedding de uma consulta, no formato aceito pelas funções SQL. */
export async function embedQuery(text: string): Promise<{ vector: string; usage: ProviderUsage }> {
  const provider = getEmbeddingProvider();
  const result = await provider.embed([text]);
  return { vector: JSON.stringify(result.value[0]), usage: result.usage };
}
