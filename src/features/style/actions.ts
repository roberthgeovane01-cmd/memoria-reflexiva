"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAnalystModel } from "@/ai/providers";
import { STYLE_ANALYZER, wrapUntrusted } from "@/ai/prompts";
import { StyleAnalysisSchema } from "@/ai/schemas";
import { requireSession } from "@/lib/supabase/server";

const listField = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(/[\n,;]/)
      .map((s) => s.trim())
      .filter(Boolean),
  );

const styleSchema = z.object({
  name: z.string().min(2),
  tone: z.string().optional(),
  perspective: z.string().optional(),
  targetLength: z.string().optional(),
  rhythm: z.string().optional(),
  structure: z.string().optional(),
  poeticity: z.coerce.number().int().min(0).max(5),
  metaphorLevel: z.coerce.number().int().min(0).max(5),
  vocabularyNotes: z.string().optional(),
  preferredExpressions: listField,
  forbiddenExpressions: listField,
  guidelines: z.string().optional(),
  authorizedValues: listField,
  safetyRules: listField,
});

export type StyleState = { error: string | null; message: string | null };

/**
 * Salvar estilo cria uma NOVA versão e aposenta a anterior.
 * O perfil de escrita é versionado como qualquer outra memória.
 */
export async function saveStyleProfile(_prev: StyleState, formData: FormData): Promise<StyleState> {
  const parsed = styleSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos.", message: null };
  }
  const data = parsed.data;

  try {
    const { supabase, workspaceId, userId } = await requireSession();

    const { data: current } = await supabase
      .from("style_profiles")
      .select("id, version")
      .eq("workspace_id", workspaceId)
      .eq("is_default", true)
      .eq("status", "active")
      .maybeSingle();

    if (current) {
      await supabase
        .from("style_profiles")
        .update({ status: "superseded", is_default: false })
        .eq("id", current.id);
    }

    const { error } = await supabase.from("style_profiles").insert({
      workspace_id: workspaceId,
      name: data.name,
      version: ((current?.version as number) ?? 0) + 1,
      is_default: true,
      tone: data.tone || null,
      perspective: data.perspective || null,
      target_length: data.targetLength || null,
      rhythm: data.rhythm || null,
      structure: data.structure || null,
      poeticity: data.poeticity,
      metaphor_level: data.metaphorLevel,
      vocabulary_notes: data.vocabularyNotes || null,
      preferred_expressions: data.preferredExpressions,
      forbidden_expressions: data.forbiddenExpressions,
      guidelines: data.guidelines || null,
      authorized_values: data.authorizedValues,
      safety_rules: data.safetyRules,
      status: "active",
      supersedes_id: current?.id ?? null,
      created_by: userId,
    });
    if (error) throw error;

    revalidatePath("/identidade");
    return { error: null, message: "Nova versão do perfil de estilo salva." };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Não foi possível salvar.",
      message: null,
    };
  }
}

export async function addStyleExample(input: {
  styleProfileId: string;
  kind: "approved" | "rejected";
  text: string;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase, workspaceId, userId } = await requireSession();
    const { error } = await supabase.from("style_examples").insert({
      workspace_id: workspaceId,
      style_profile_id: input.styleProfileId,
      kind: input.kind,
      text: input.text.trim(),
      note: input.note ?? null,
      created_by: userId,
    });
    if (error) throw error;
    revalidatePath("/identidade");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Falhou." };
  }
}

/**
 * Deriva um perfil a partir de textos autorais aprovados — NUNCA a partir dos
 * livros da biblioteca. Ter um autor na memória não autoriza copiar o estilo
 * dele.
 */
export async function analyzeStyleFromSamples(): Promise<{
  ok: boolean;
  error?: string;
  data?: Record<string, unknown>;
}> {
  try {
    const { supabase, workspaceId } = await requireSession();

    const { data: samples } = await supabase
      .from("sources")
      .select("title, source_versions(normalized_text)")
      .eq("workspace_id", workspaceId)
      .in("kind", ["authored_text", "imported_reflection"])
      .limit(5);

    type Row = { title: string; source_versions: Array<{ normalized_text: string | null }> };
    const texts = ((samples ?? []) as unknown as Row[])
      .map((s) => s.source_versions?.[0]?.normalized_text ?? "")
      .filter(Boolean)
      .map((t) => t.slice(0, 12_000));

    if (texts.length === 0) {
      return {
        ok: false,
        error:
          "Nenhum texto autoral seu na biblioteca. Adicione documentos marcados como " +
          '"texto autoral meu" para que o estilo possa ser derivado dos seus próprios textos.',
      };
    }

    const model = getAnalystModel();
    const { value } = await model.generateStructured({
      promptName: STYLE_ANALYZER.name,
      promptVersion: STYLE_ANALYZER.version,
      system: STYLE_ANALYZER.system,
      user: wrapUntrusted("Amostras de escrita da própria pessoa", texts.join("\n\n---\n\n")),
      schema: StyleAnalysisSchema,
      schemaName: STYLE_ANALYZER.schemaName!,
      maxOutputTokens: 2000,
      demoFallback: () => ({
        tone: "",
        rhythm: "",
        structure: "",
        perspective: "primeira pessoa",
        poeticity: 2,
        metaphor_level: 2,
        vocabulary_notes:
          "[modo demonstração] A análise de estilo precisa de um modelo de linguagem.",
        preferred_expressions: [],
        forbidden_expressions: [],
        guidelines:
          "[modo demonstração] Configure uma chave de IA para derivar o perfil das suas amostras.",
      }),
    });

    return { ok: true, data: value as unknown as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Falhou." };
  }
}
