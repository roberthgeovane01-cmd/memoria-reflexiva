import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriterModel } from "@/ai/providers";
import { REFLECTION_WRITER, wrapUntrusted } from "@/ai/prompts";
import { ReflectionOutputSchema, type ReflectionOutput } from "@/ai/schemas";
import { recordAudit } from "@/lib/audit";
import { sha256 } from "@/services/ingestion/text";
import { buildContextPack, renderContextPack, type ContextPack } from "./context-pack";

export type WriteResult = {
  reflectionId: string;
  versionId: string;
  versionNumber: number;
  title: string;
  text: string;
  declaredGaps: string[];
  demo: boolean;
};

/**
 * REFLECTION WRITER — a última etapa, e só depois de tudo o mais.
 *
 * A separação entre IA analista e IA escritora é estrutural: o escritor não
 * pesquisa, não classifica evidência e não decide conflito. Ele recebe o
 * Context Pack pronto e escreve.
 */
export async function writeReflection(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string | null;
    reflectionSessionId: string;
  },
): Promise<WriteResult> {
  const pack = await buildContextPack(supabase, {
    workspaceId: input.workspaceId,
    reflectionSessionId: input.reflectionSessionId,
  });

  await supabase
    .from("reflection_sessions")
    .update({ status: "writing" })
    .eq("id", input.reflectionSessionId);

  const model = getWriterModel();
  const { value, usage } = await model.generateStructured({
    promptName: REFLECTION_WRITER.name,
    promptVersion: REFLECTION_WRITER.version,
    system: REFLECTION_WRITER.system,
    user: [
      wrapUntrusted("FALA DA PESSOA (transcrição aprovada por ela)", pack.approvedTranscript),
      "",
      renderContextPack(pack),
    ].join("\n"),
    schema: ReflectionOutputSchema,
    schemaName: REFLECTION_WRITER.schemaName!,
    temperature: 0.8,
    maxOutputTokens: 4000,
    demoFallback: () => demoReflection(pack),
  });

  const clean = sanitize(value, pack);

  // Reflexão e primeira versão. Nunca sobrescrevemos: cada geração é uma versão.
  const { data: existing } = await supabase
    .from("reflections")
    .select("id")
    .eq("session_id", input.reflectionSessionId)
    .maybeSingle();

  let reflectionId: string;
  if (existing) {
    reflectionId = existing.id as string;
    await supabase.from("reflections").update({ title: clean.title }).eq("id", reflectionId);
  } else {
    const { data: created, error } = await supabase
      .from("reflections")
      .insert({
        workspace_id: input.workspaceId,
        session_id: input.reflectionSessionId,
        title: clean.title,
        created_by: input.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    reflectionId = created.id as string;
  }

  const { data: lastVersion } = await supabase
    .from("reflection_versions")
    .select("id, version_number")
    .eq("reflection_id", reflectionId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const versionNumber = ((lastVersion?.version_number as number) ?? 0) + 1;

  const { data: version, error: versionError } = await supabase
    .from("reflection_versions")
    .insert({
      workspace_id: input.workspaceId,
      reflection_id: reflectionId,
      parent_version_id: (lastVersion?.id as string) ?? null,
      version_number: versionNumber,
      text: clean.text,
      text_hash: sha256(clean.text),
      word_count: clean.text.split(/\s+/).filter(Boolean).length,
      origin: "ai",
      model: usage.demo ? "demo-writer" : usage.model,
      style_profile_id: pack.styleProfile?.id ?? null,
      status: "draft",
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (versionError) throw versionError;

  const versionId = version.id as string;

  await supabase
    .from("reflections")
    .update({ current_version_id: versionId, status: "editing" })
    .eq("id", reflectionId);

  // Rastreabilidade: de qual evidência esta versão veio.
  const evidenceById = new Map(pack.evidence.map((e) => [e.hitId, e]));
  const rows = clean.used_evidence_ids
    .map((hitId) => evidenceById.get(hitId))
    .filter(Boolean)
    .map((evidence) => ({
      workspace_id: input.workspaceId,
      reflection_version_id: versionId,
      source_id: evidence!.sourceId,
      role: "support" as const,
      created_by: input.userId,
    }));
  if (rows.length) await supabase.from("reflection_sources").insert(rows);

  await supabase
    .from("reflection_sessions")
    .update({ status: "editing" })
    .eq("id", input.reflectionSessionId);

  await recordAudit(supabase, {
    workspaceId: input.workspaceId,
    actorId: input.userId,
    actorKind: "ai",
    action: "write_reflection",
    entityKind: "reflection_version",
    entityId: versionId,
    usage,
    metadata: {
      prompt: `${REFLECTION_WRITER.name}@${REFLECTION_WRITER.version}`,
      evidence_used: rows.length,
      gaps: clean.declared_gaps.length,
    },
  });

  return {
    reflectionId,
    versionId,
    versionNumber,
    title: clean.title,
    text: clean.text,
    declaredGaps: clean.declared_gaps,
    demo: usage.demo,
  };
}

/** Remove citações a evidências inexistentes antes de gravar. */
function sanitize(output: ReflectionOutput, pack: ContextPack): ReflectionOutput {
  const known = new Set(pack.evidence.map((e) => e.hitId));
  return {
    ...output,
    text: output.text.trim(),
    title: output.title.trim() || "Reflexão sem título",
    used_evidence_ids: output.used_evidence_ids.filter((id) => known.has(id)),
  };
}

/**
 * Redação do modo demonstração.
 *
 * NÃO tenta escrever literatura no lugar do modelo. Devolve a fala da pessoa
 * organizada e um relatório honesto do que a memória encontrou, deixando claro
 * que nenhum texto autoral foi gerado. Fingir uma reflexão seria pior do que
 * não ter uma.
 */
function demoReflection(pack: ContextPack): ReflectionOutput {
  const dossier = pack.dossier as { has_memory?: boolean; executive_summary?: string };
  const first = pack.approvedTranscript.split(/(?<=[.!?])\s+/)[0] ?? "";

  const body = [
    "[MODO DEMONSTRAÇÃO — este texto não foi escrito por um modelo de linguagem]",
    "",
    "Sua fala, como você a revisou:",
    "",
    pack.approvedTranscript,
    "",
    "O que a memória encontrou:",
    "",
    dossier.executive_summary ?? "Nenhuma síntese disponível.",
    "",
    pack.evidence.length
      ? `Foram recuperados ${pack.evidence.length} trecho(s) de ${
          new Set(pack.evidence.map((e) => e.sourceId)).size
        } fonte(s) da sua biblioteca. Eles estão listados na Mesa de Revisão, cada um com a origem.`
      : "Nenhuma evidência foi recuperada na sua biblioteca sobre este assunto. " +
        "O sistema não vai simular lembrança.",
    "",
    pack.conflictResolutions.length
      ? `Suas decisões sobre ${pack.conflictResolutions.length} conflito(s) foram registradas e ` +
        "serão respeitadas quando a escrita com IA estiver ligada."
      : "Nenhum conflito exigiu decisão sua.",
    "",
    "Configure uma chave de IA em Configurações para que a reflexão autoral seja escrita.",
  ].join("\n");

  return {
    title: first.slice(0, 80) || "Reflexão",
    text: body,
    used_evidence_ids: pack.evidence.map((e) => e.hitId),
    declared_gaps: dossier.has_memory
      ? ["Texto autoral não gerado: modo demonstração."]
      : [
          "Texto autoral não gerado: modo demonstração.",
          "A biblioteca não tem memória sobre este assunto.",
        ],
  };
}
