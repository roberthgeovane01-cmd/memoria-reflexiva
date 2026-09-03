import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderUsage } from "@/ai/providers/types";

/**
 * Observabilidade.
 *
 * Registramos provider, modelo, latência, tokens e custo estimado — mas NUNCA
 * o conteúdo pessoal integral. O que vai para o log é metadado; o conteúdo fica
 * nas tabelas do próprio usuário, protegido por RLS.
 */

// Preços aproximados por 1M de tokens (USD). Servem para estimativa, não para
// cobrança. Ajuste conforme a tabela vigente do fornecedor.
const PRICE_TABLE: Record<string, { in: number; out: number }> = {
  "gpt-5": { in: 1.25, out: 10 },
  "gpt-5-mini": { in: 0.25, out: 2 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "text-embedding-3-small": { in: 0.02, out: 0 },
  "text-embedding-3-large": { in: 0.13, out: 0 },
};

export function estimateCost(usage: ProviderUsage): number | null {
  const price = PRICE_TABLE[usage.model];
  if (!price) return null;
  const input = ((usage.tokensIn ?? 0) / 1_000_000) * price.in;
  const output = ((usage.tokensOut ?? 0) / 1_000_000) * price.out;
  return Number((input + output).toFixed(6));
}

export async function recordAudit(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    actorId?: string | null;
    actorKind?: "user" | "system" | "ai";
    action: string;
    entityKind?: string | null;
    entityId?: string | null;
    usage?: ProviderUsage | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("audit_logs").insert({
    workspace_id: input.workspaceId,
    actor_id: input.actorId ?? null,
    actor_kind: input.actorKind ?? "system",
    action: input.action,
    entity_kind: input.entityKind ?? null,
    entity_id: input.entityId ?? null,
    provider: input.usage?.provider ?? null,
    model: input.usage?.model ?? null,
    latency_ms: input.usage?.latencyMs ?? null,
    tokens_in: input.usage?.tokensIn ?? null,
    tokens_out: input.usage?.tokensOut ?? null,
    estimated_cost: input.usage ? estimateCost(input.usage) : null,
    metadata: { demo: input.usage?.demo ?? false, ...(input.metadata ?? {}) },
  });

  // Auditoria nunca deve derrubar a operação principal.
  if (error) console.warn("[audit] falha ao registrar:", error.message);
}
