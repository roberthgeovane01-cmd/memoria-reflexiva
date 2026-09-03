export const SESSION_STATUS_LABELS: Record<string, string> = {
  draft: "rascunho",
  awaiting_transcription: "transcrevendo",
  transcript_review: "revisar transcrição",
  investigating: "investigando a memória",
  needs_conflict_review: "conflito aguardando decisão",
  dossier_ready: "dossiê pronto",
  writing: "escrevendo",
  editing: "em edição",
  approved: "aprovada",
  failed: "falhou",
  archived: "arquivada",
};

export function sessionStatusTone(
  status: string,
): "neutral" | "accent" | "danger" | "success" | "memory" {
  if (status === "approved") return "success";
  if (status === "needs_conflict_review" || status === "failed") return "danger";
  if (status === "investigating" || status === "writing") return "memory";
  if (status === "transcript_review" || status === "dossier_ready" || status === "editing")
    return "accent";
  return "neutral";
}

export const CONFLICT_KIND_LABELS: Record<string, string> = {
  complement: "complemento",
  minor_divergence: "divergência pequena",
  factual_conflict: "conflito factual",
  interpretive_divergence: "divergência interpretativa",
  source_conflict: "conflito entre fontes",
};

export const CLASSIFICATION_LABELS: Record<string, string> = {
  supports: "sustenta",
  complements: "complementa",
  contradicts: "contradiz",
  qualifies: "ressalva",
  unrelated: "não relacionado",
};
