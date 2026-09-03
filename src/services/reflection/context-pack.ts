import type { SupabaseClient } from "@supabase/supabase-js";

export type StyleProfile = {
  id: string;
  name: string;
  tone: string | null;
  perspective: string | null;
  target_length: string | null;
  rhythm: string | null;
  structure: string | null;
  poeticity: number | null;
  metaphor_level: number | null;
  vocabulary_notes: string | null;
  preferred_expressions: string[];
  forbidden_expressions: string[];
  guidelines: string | null;
  authorized_values: string[];
  safety_rules: string[];
};

export type ConflictDecision = {
  conflictId: string;
  title: string;
  kind: string;
  severity: string;
  description: string;
  decision: string;
  decisionLabel: string;
  manualText: string | null;
  ignoredSourceId: string | null;
};

export type ContextPack = {
  approvedTranscript: string;
  centralQuestion: string;
  dossier: Record<string, unknown>;
  evidence: Array<{
    hitId: string;
    sourceId: string | null;
    sourceTitle: string;
    authorityLevel: number;
    text: string;
  }>;
  conflictResolutions: ConflictDecision[];
  styleProfile: StyleProfile | null;
  authorizedValues: string[];
  outputPreferences: { targetLength: string; perspective: string };
  safetyRules: string[];
  ignoredSourceIds: string[];
};

export const DECISION_LABELS: Record<string, string> = {
  keep_speech: "Manter a minha fala como está",
  use_memory: "Usar o que a memória registra",
  treat_as_complement: "Tratar como complemento, não como contradição",
  treat_as_evolution: "Entender como uma evolução da minha posição",
  manual_edit: "Usar a redação que eu escrevi",
  ignore_source: "Ignorar esta fonte neste contexto",
};

const BASE_SAFETY_RULES = [
  "Não inventar fatos, datas, nomes, falas, citações ou preferências.",
  "Não afirmar emoções que a pessoa não declarou.",
  "Não citar fonte que não esteja entre as evidências fornecidas.",
  "Declarar a ausência quando a memória não sustentar o que seria dito.",
  "Não imitar o estilo dos autores da biblioteca.",
  "Obedecer às decisões humanas sobre conflitos.",
];

/**
 * CONTEXT PACK — tudo o que o escritor recebe, e nada além disso.
 *
 * Montado somente depois da revisão da transcrição, da investigação e das
 * decisões humanas sobre conflitos.
 */
export async function buildContextPack(
  supabase: SupabaseClient,
  input: { workspaceId: string; reflectionSessionId: string },
): Promise<ContextPack> {
  const { data: session, error } = await supabase
    .from("reflection_sessions")
    .select(
      "id, transcript_id, dossier_id, retrieval_session_id, style_profile_id, central_question",
    )
    .eq("id", input.reflectionSessionId)
    .single();
  if (error) throw error;

  const { data: transcript } = await supabase
    .from("transcripts")
    .select("approved_transcript, raw_transcript, status")
    .eq("id", session.transcript_id)
    .maybeSingle();

  if (!transcript || transcript.status !== "approved" || !transcript.approved_transcript) {
    throw new Error("A transcrição precisa ser revisada e aprovada antes de escrever a reflexão.");
  }

  const { data: dossier } = await supabase
    .from("memory_dossiers")
    .select("*")
    .eq("id", session.dossier_id)
    .maybeSingle();
  if (!dossier) throw new Error("Esta sessão ainda não tem dossiê de memória.");

  // Evidências selecionadas na investigação, com a fonte de cada uma.
  const { data: hits } = await supabase
    .from("retrieval_hits")
    .select(
      "id, owner_kind, owner_id, source_id, snippet, authority_level, final_score, sources(title)",
    )
    .eq("retrieval_session_id", session.retrieval_session_id)
    .eq("selected", true)
    .order("final_score", { ascending: false });

  type HitRow = {
    id: string;
    source_id: string | null;
    snippet: string | null;
    authority_level: number | null;
    sources: { title: string } | null;
  };

  // Conflitos e as decisões humanas.
  const { data: conflicts } = await supabase
    .from("conflicts")
    .select(
      "id, title, kind, severity, description, blocking, status, " +
        "conflict_resolutions(decision, manual_text, ignored_source_id, decided_at)",
    )
    .eq("reflection_session_id", input.reflectionSessionId);

  type ConflictRow = {
    id: string;
    title: string;
    kind: string;
    severity: string;
    description: string;
    blocking: boolean;
    status: string;
    conflict_resolutions: Array<{
      decision: string;
      manual_text: string | null;
      ignored_source_id: string | null;
      decided_at: string;
    }> | null;
  };

  const decisions: ConflictDecision[] = [];
  const ignoredSourceIds: string[] = [];

  for (const conflict of (conflicts ?? []) as unknown as ConflictRow[]) {
    const resolution = [...(conflict.conflict_resolutions ?? [])].sort((a, b) =>
      a.decided_at < b.decided_at ? 1 : -1,
    )[0];

    if (conflict.blocking && !resolution) {
      throw new Error(
        `O conflito "${conflict.title}" é factual e de severidade alta. ` +
          `A geração fica bloqueada até você decidir o que fazer com ele.`,
      );
    }
    if (!resolution) continue;

    if (resolution.decision === "ignore_source" && resolution.ignored_source_id) {
      ignoredSourceIds.push(resolution.ignored_source_id);
    }

    decisions.push({
      conflictId: conflict.id,
      title: conflict.title,
      kind: conflict.kind,
      severity: conflict.severity,
      description: conflict.description,
      decision: resolution.decision,
      decisionLabel: DECISION_LABELS[resolution.decision] ?? resolution.decision,
      manualText: resolution.manual_text,
      ignoredSourceId: resolution.ignored_source_id,
    });
  }

  const evidence = ((hits ?? []) as unknown as HitRow[])
    .filter((hit) => !hit.source_id || !ignoredSourceIds.includes(hit.source_id))
    .map((hit) => ({
      hitId: hit.id,
      sourceId: hit.source_id,
      sourceTitle: hit.sources?.title ?? "Memória",
      authorityLevel: hit.authority_level ?? 3,
      text: hit.snippet ?? "",
    }));

  // Perfil de estilo: o da sessão, ou o padrão do workspace.
  const styleQuery = supabase
    .from("style_profiles")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("status", "active");

  const { data: style } = session.style_profile_id
    ? await styleQuery.eq("id", session.style_profile_id).maybeSingle()
    : await styleQuery.eq("is_default", true).maybeSingle();

  const styleProfile = (style as unknown as StyleProfile | null) ?? null;

  return {
    approvedTranscript: transcript.approved_transcript as string,
    centralQuestion: (dossier.central_question as string) ?? session.central_question ?? "",
    dossier: dossier as Record<string, unknown>,
    evidence,
    conflictResolutions: decisions,
    styleProfile,
    authorizedValues: styleProfile?.authorized_values ?? [],
    outputPreferences: {
      targetLength: styleProfile?.target_length ?? "media",
      perspective: styleProfile?.perspective ?? "primeira pessoa",
    },
    safetyRules: [...BASE_SAFETY_RULES, ...(styleProfile?.safety_rules ?? [])],
    ignoredSourceIds,
  };
}

/** Renderiza o Context Pack no formato que o escritor recebe. */
export function renderContextPack(pack: ContextPack): string {
  const dossier = pack.dossier as {
    executive_summary?: string;
    has_memory?: boolean;
    convergences?: Array<{ statement: string; detail: string; evidence_ids: string[] }>;
    complements?: Array<{ statement: string; detail: string; evidence_ids: string[] }>;
    tensions?: Array<{ statement: string; detail: string; evidence_ids: string[] }>;
    contradictions?: Array<{ statement: string; detail: string; evidence_ids: string[] }>;
    knowledge_gaps?: string[];
    editorial_notes?: string[];
  };

  const findings = (
    label: string,
    items?: Array<{ statement: string; detail: string; evidence_ids: string[] }>,
  ) =>
    items?.length
      ? `${label}:\n` +
        items
          .map(
            (f) =>
              `  - ${f.statement}\n    ${f.detail}\n    evidências: ${f.evidence_ids.join(", ")}`,
          )
          .join("\n")
      : `${label}: nenhum.`;

  const style = pack.styleProfile;

  return [
    `QUESTÃO CENTRAL: ${pack.centralQuestion}`,
    "",
    "DOSSIÊ DE MEMÓRIA",
    `memória disponível: ${dossier.has_memory ? "sim" : "NÃO — declare a ausência"}`,
    `síntese: ${dossier.executive_summary ?? "—"}`,
    findings("convergências", dossier.convergences),
    findings("complementos", dossier.complements),
    findings("tensões", dossier.tensions),
    findings("contradições", dossier.contradictions),
    `lacunas de conhecimento: ${(dossier.knowledge_gaps ?? []).join(" | ") || "nenhuma registrada"}`,
    `notas editoriais: ${(dossier.editorial_notes ?? []).join(" | ") || "nenhuma"}`,
    "",
    "EVIDÊNCIAS DISPONÍVEIS (cite apenas estes identificadores)",
    pack.evidence.length
      ? pack.evidence
          .map((e) => `[${e.hitId}] ${e.sourceTitle} (autoridade ${e.authorityLevel}/5)\n${e.text}`)
          .join("\n\n")
      : "nenhuma evidência foi recuperada.",
    "",
    "DECISÕES HUMANAS SOBRE CONFLITOS (são ordens)",
    pack.conflictResolutions.length
      ? pack.conflictResolutions
          .map(
            (d) =>
              `- ${d.title} [${d.kind}/${d.severity}] → ${d.decisionLabel}` +
              (d.manualText ? `\n  redação definida pela pessoa: "${d.manualText}"` : ""),
          )
          .join("\n")
      : "nenhum conflito exigiu decisão.",
    "",
    "PERFIL DE ESTILO AUTORAL",
    style
      ? [
          `nome: ${style.name}`,
          `tom: ${style.tone ?? "—"}`,
          `perspectiva: ${style.perspective ?? "—"}`,
          `extensão desejada: ${style.target_length ?? "média"}`,
          `ritmo: ${style.rhythm ?? "—"}`,
          `estrutura: ${style.structure ?? "—"}`,
          `poeticidade (0-5): ${style.poeticity ?? "—"}`,
          `nível de metáfora (0-5): ${style.metaphor_level ?? "—"}`,
          `vocabulário: ${style.vocabulary_notes ?? "—"}`,
          `expressões preferidas: ${style.preferred_expressions.join(", ") || "—"}`,
          `expressões proibidas: ${style.forbidden_expressions.join(", ") || "—"}`,
          `diretrizes: ${style.guidelines ?? "—"}`,
        ].join("\n")
      : "nenhum perfil configurado; escreva em prosa sóbria, primeira pessoa.",
    "",
    `VALORES AUTORIZADOS: ${pack.authorizedValues.join(" | ") || "nenhum declarado"}`,
    "",
    `REGRAS DE SEGURANÇA:\n${pack.safetyRules.map((r) => `- ${r}`).join("\n")}`,
  ].join("\n");
}
