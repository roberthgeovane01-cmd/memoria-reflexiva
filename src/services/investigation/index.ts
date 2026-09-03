import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnalystModel } from "@/ai/providers";
import {
  CONFLICT_ANALYZER,
  EVIDENCE_CLASSIFIER,
  MEMORY_ANALYST,
  wrapUntrusted,
} from "@/ai/prompts";
import {
  ConflictAnalysisSchema,
  EvidenceClassificationSchema,
  MemoryDossierSchema,
  type ConflictAnalysis,
  type EvidenceClassification,
  type MemoryDossier,
} from "@/ai/schemas";
import { recordAudit } from "@/lib/audit";
import { truncate } from "@/lib/utils";
import type { EvidenceItem, RetrievalResult } from "@/services/retrieval/engine";
import {
  heuristicConflictAnalysis,
  heuristicDossier,
  heuristicEvidenceClassification,
} from "./heuristics";

export type InvestigationResult = {
  dossierId: string;
  dossier: MemoryDossier;
  conflicts: Array<{
    id: string;
    kind: string;
    severity: string;
    blocking: boolean;
    title: string;
  }>;
  blocking: boolean;
  classifications: EvidenceClassification;
  demo: boolean;
};

/**
 * INVESTIGAÇÃO: da evidência bruta ao Dossiê de Memória.
 *
 * Três responsabilidades distintas, nesta ordem, e nunca em uma só chamada:
 *   1. Evidence Classifier — como cada evidência se relaciona com a fala
 *   2. Conflict Analyzer   — onde estão as tensões (sem resolvê-las)
 *   3. Memory Analyst      — a síntese rastreável
 *
 * O escritor não participa de nenhuma destas etapas.
 */
export async function runInvestigation(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string | null;
    reflectionSessionId: string | null;
    retrieval: RetrievalResult;
    speechText: string;
  },
): Promise<InvestigationResult> {
  const model = getAnalystModel();
  const evidence = input.retrieval.selected;
  const centralQuestion = input.retrieval.plan.central_question;

  await supabase
    .from("retrieval_sessions")
    .update({ status: "classifying" })
    .eq("id", input.retrieval.retrievalSessionId);

  // ---- 1. Classificação das evidências -----------------------------------
  const classificationResult = await model.generateStructured({
    promptName: EVIDENCE_CLASSIFIER.name,
    promptVersion: EVIDENCE_CLASSIFIER.version,
    system: EVIDENCE_CLASSIFIER.system,
    user: [
      wrapUntrusted("FALA ATUAL", input.speechText),
      "",
      `QUESTÃO CENTRAL: ${centralQuestion}`,
      "",
      wrapUntrusted("EVIDÊNCIAS RECUPERADAS", renderEvidence(evidence)),
    ].join("\n"),
    schema: EvidenceClassificationSchema,
    schemaName: EVIDENCE_CLASSIFIER.schemaName!,
    maxOutputTokens: 4000,
    demoFallback: () => heuristicEvidenceClassification(input.speechText, evidence),
  });
  const classifications = filterKnownEvidence(classificationResult.value, evidence);

  await recordAudit(supabase, {
    workspaceId: input.workspaceId,
    actorKind: "ai",
    action: "classify_evidence",
    entityKind: "retrieval_session",
    entityId: input.retrieval.retrievalSessionId,
    usage: classificationResult.usage,
  });

  // ---- 2. Conflitos -------------------------------------------------------
  const conflictResult = await model.generateStructured({
    promptName: CONFLICT_ANALYZER.name,
    promptVersion: CONFLICT_ANALYZER.version,
    system: CONFLICT_ANALYZER.system,
    user: [
      wrapUntrusted("FALA ATUAL", input.speechText),
      "",
      wrapUntrusted("EVIDÊNCIAS COM CLASSIFICAÇÃO", renderEvidence(evidence, classifications)),
    ].join("\n"),
    schema: ConflictAnalysisSchema,
    schemaName: CONFLICT_ANALYZER.schemaName!,
    maxOutputTokens: 3000,
    demoFallback: () => heuristicConflictAnalysis(input.speechText, evidence, classifications),
  });
  const conflictAnalysis = filterKnownConflicts(conflictResult.value, evidence);

  await recordAudit(supabase, {
    workspaceId: input.workspaceId,
    actorKind: "ai",
    action: "analyze_conflicts",
    entityKind: "retrieval_session",
    entityId: input.retrieval.retrievalSessionId,
    usage: conflictResult.usage,
    metadata: { conflicts: conflictAnalysis.conflicts.length },
  });

  // ---- 3. Dossiê ----------------------------------------------------------
  const dossierResult = await model.generateStructured({
    promptName: MEMORY_ANALYST.name,
    promptVersion: MEMORY_ANALYST.version,
    system: MEMORY_ANALYST.system,
    user: [
      `QUESTÃO CENTRAL: ${centralQuestion}`,
      "",
      wrapUntrusted("FALA ATUAL", input.speechText),
      "",
      wrapUntrusted("EVIDÊNCIAS", renderEvidence(evidence, classifications)),
      "",
      wrapUntrusted("CONFLITOS DETECTADOS", renderConflicts(conflictAnalysis)),
    ].join("\n"),
    schema: MemoryDossierSchema,
    schemaName: MEMORY_ANALYST.schemaName!,
    maxOutputTokens: 6000,
    demoFallback: () =>
      heuristicDossier(centralQuestion, input.speechText, evidence, classifications),
  });
  const dossier = sanitizeDossier(dossierResult.value, evidence);

  await recordAudit(supabase, {
    workspaceId: input.workspaceId,
    actorKind: "ai",
    action: "memory_dossier",
    entityKind: "retrieval_session",
    entityId: input.retrieval.retrievalSessionId,
    usage: dossierResult.usage,
  });

  // ---- 4. Persistência ----------------------------------------------------
  const blockingConflicts = conflictAnalysis.conflicts.filter(
    (c) => c.kind === "factual_conflict" && c.severity === "high",
  );
  const blocking = blockingConflicts.length > 0;

  const { data: dossierRow, error: dossierError } = await supabase
    .from("memory_dossiers")
    .insert({
      workspace_id: input.workspaceId,
      retrieval_session_id: input.retrieval.retrievalSessionId,
      reflection_session_id: input.reflectionSessionId,
      central_question: dossier.central_question,
      executive_summary: dossier.executive_summary,
      convergences: dossier.convergences,
      complements: dossier.complements,
      tensions: dossier.tensions,
      contradictions: dossier.contradictions,
      temporal_evolution: dossier.temporal_evolution,
      related_episodes: dossier.related_episodes,
      knowledge_gaps: dossier.knowledge_gaps,
      central_sources: dossier.central_sources,
      editorial_notes: dossier.editorial_notes,
      has_memory: dossier.has_memory,
      coverage_score: coverage(dossier, evidence),
      diversity_score: input.retrieval.stats.diversity,
      model: dossierResult.usage.demo ? "heuristic-demo" : dossierResult.usage.model,
      status: blocking ? "needs_conflict_review" : "ready",
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (dossierError) throw dossierError;
  const dossierId = dossierRow.id as string;

  // Rastreabilidade: cada achado do dossiê aponta para as evidências reais.
  const evidenceRows = buildDossierEvidence(
    dossierId,
    input.workspaceId,
    dossier,
    classifications,
    evidence,
    input.userId,
  );
  if (evidenceRows.length) {
    const { error } = await supabase.from("dossier_evidence").insert(evidenceRows);
    if (error) throw error;
  }

  const storedConflicts: InvestigationResult["conflicts"] = [];
  for (const conflict of conflictAnalysis.conflicts) {
    const isBlocking = conflict.kind === "factual_conflict" && conflict.severity === "high";
    const { data, error } = await supabase
      .from("conflicts")
      .insert({
        workspace_id: input.workspaceId,
        retrieval_session_id: input.retrieval.retrievalSessionId,
        dossier_id: dossierId,
        reflection_session_id: input.reflectionSessionId,
        kind: conflict.kind,
        severity: conflict.severity,
        blocking: isBlocking,
        title: conflict.title,
        description: conflict.description,
        speech_excerpt: conflict.speech_excerpt,
        memory_excerpt: conflict.memory_excerpt,
        left_ref: { evidence_ids: conflict.evidence_ids },
        right_ref: {},
        detector: conflictResult.usage.demo ? "heuristic" : "llm",
        model: conflictResult.usage.demo ? "heuristic-demo" : conflictResult.usage.model,
        confidence: conflict.confidence,
        created_by: input.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    storedConflicts.push({
      id: data.id as string,
      kind: conflict.kind,
      severity: conflict.severity,
      blocking: isBlocking,
      title: conflict.title,
    });
  }

  if (input.reflectionSessionId) {
    await supabase
      .from("reflection_sessions")
      .update({
        retrieval_session_id: input.retrieval.retrievalSessionId,
        dossier_id: dossierId,
        central_question: dossier.central_question,
        intent: input.retrieval.plan.intent,
        status: blocking ? "needs_conflict_review" : "dossier_ready",
        status_reason: blocking
          ? "Há conflito factual de severidade alta aguardando decisão humana."
          : null,
      })
      .eq("id", input.reflectionSessionId);
  }

  return {
    dossierId,
    dossier,
    conflicts: storedConflicts,
    blocking,
    classifications,
    demo: dossierResult.usage.demo,
  };
}

// --------------------------------------------------------------------------

function renderEvidence(
  evidence: EvidenceItem[],
  classifications?: EvidenceClassification,
): string {
  const byId = new Map((classifications?.classifications ?? []).map((c) => [c.evidence_id, c]));
  return evidence
    .map((item, index) => {
      const classification = byId.get(item.hitId);
      const header = [
        `[${index + 1}] evidence_id: ${item.hitId}`,
        `fonte: ${item.sourceTitle} (autoridade ${item.authorityLevel}/5)`,
        item.sectionTitle ? `seção: ${item.sectionTitle}` : null,
        item.pageStart ? `página: ${item.pageStart}` : null,
        classification ? `classificação prévia: ${classification.classification}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
      return `${header}\n${item.contextText || item.text}`;
    })
    .join("\n\n---\n\n");
}

function renderConflicts(analysis: ConflictAnalysis): string {
  if (analysis.conflicts.length === 0) return "Nenhum conflito detectado.";
  return analysis.conflicts
    .map(
      (c, i) =>
        `[${i + 1}] ${c.kind} (${c.severity}) — ${c.title}\n${c.description}\n` +
        `evidências: ${c.evidence_ids.join(", ")}`,
    )
    .join("\n\n");
}

/** Descarta classificações que citem identificadores inexistentes. */
function filterKnownEvidence(
  classification: EvidenceClassification,
  evidence: EvidenceItem[],
): EvidenceClassification {
  const known = new Set(evidence.map((e) => e.hitId));
  return {
    classifications: classification.classifications.filter((c) => known.has(c.evidence_id)),
  };
}

function filterKnownConflicts(
  analysis: ConflictAnalysis,
  evidence: EvidenceItem[],
): ConflictAnalysis {
  const known = new Set(evidence.map((e) => e.hitId));
  return {
    conflicts: analysis.conflicts.map((c) => ({
      ...c,
      evidence_ids: c.evidence_ids.filter((id) => known.has(id)),
    })),
  };
}

/**
 * Guarda-corpo contra alucinação: um achado que cite evidência inexistente é
 * removido do dossiê. Se todos os achados forem removidos, has_memory vira
 * falso — o sistema declara ausência em vez de fingir.
 */
function sanitizeDossier(dossier: MemoryDossier, evidence: EvidenceItem[]): MemoryDossier {
  const knownEvidence = new Set(evidence.map((e) => e.hitId));
  const knownSources = new Set(evidence.map((e) => e.sourceId).filter(Boolean) as string[]);
  const knownEpisodes = new Set(
    evidence.filter((e) => e.ownerKind === "episode").map((e) => e.ownerId),
  );

  const clean = <T extends { evidence_ids: string[]; source_ids?: string[] }>(items: T[]): T[] =>
    items
      .map((item) => ({
        ...item,
        evidence_ids: item.evidence_ids.filter((id) => knownEvidence.has(id)),
        ...(item.source_ids
          ? { source_ids: item.source_ids.filter((id) => knownSources.has(id)) }
          : {}),
      }))
      .filter((item) => item.evidence_ids.length > 0);

  const convergences = clean(dossier.convergences);
  const complements = clean(dossier.complements);
  const tensions = clean(dossier.tensions);
  const contradictions = clean(dossier.contradictions);
  const total = convergences.length + complements.length + tensions.length + contradictions.length;

  return {
    ...dossier,
    convergences,
    complements,
    tensions,
    contradictions,
    temporal_evolution: dossier.temporal_evolution
      .map((t) => ({ ...t, evidence_ids: t.evidence_ids.filter((id) => knownEvidence.has(id)) }))
      .filter((t) => t.evidence_ids.length > 0),
    related_episodes: dossier.related_episodes.filter((e) => knownEpisodes.has(e.episode_id)),
    central_sources: dossier.central_sources.filter((s) => knownSources.has(s.source_id)),
    has_memory: dossier.has_memory && total > 0,
    executive_summary:
      total === 0
        ? "Não há memória suficiente na biblioteca para sustentar uma investigação sobre este " +
          "assunto. Nenhuma evidência rastreável foi encontrada."
        : dossier.executive_summary,
  };
}

function coverage(dossier: MemoryDossier, evidence: EvidenceItem[]): number {
  if (evidence.length === 0) return 0;
  const cited = new Set<string>();
  const groups = [
    dossier.convergences,
    dossier.complements,
    dossier.tensions,
    dossier.contradictions,
  ];
  for (const group of groups)
    for (const item of group) for (const id of item.evidence_ids) cited.add(id);
  return Number((cited.size / evidence.length).toFixed(3));
}

function buildDossierEvidence(
  dossierId: string,
  workspaceId: string,
  dossier: MemoryDossier,
  classifications: EvidenceClassification,
  evidence: EvidenceItem[],
  userId: string | null,
) {
  const byId = new Map(evidence.map((e) => [e.hitId, e]));
  const classificationById = new Map(
    classifications.classifications.map((c) => [c.evidence_id, c]),
  );

  const rows: Array<Record<string, unknown>> = [];
  const push = (
    findingKey: string,
    findingIndex: number,
    fallbackClassification: "supports" | "complements" | "contradicts" | "qualifies",
    evidenceIds: string[],
    rationale: string,
  ) => {
    for (const evidenceId of evidenceIds) {
      const item = byId.get(evidenceId);
      if (!item) continue;
      rows.push({
        workspace_id: workspaceId,
        dossier_id: dossierId,
        finding_key: findingKey,
        finding_index: findingIndex,
        classification:
          classificationById.get(evidenceId)?.classification ?? fallbackClassification,
        retrieval_hit_id: item.hitId,
        source_id: item.sourceId,
        chunk_id: item.ownerKind === "chunk" ? item.ownerId : null,
        claim_id: item.ownerKind === "claim" ? item.ownerId : null,
        episode_id: item.ownerKind === "episode" ? item.ownerId : null,
        quote: truncate(item.text, 600),
        rationale,
        confidence: classificationById.get(evidenceId)?.confidence ?? null,
        created_by: userId,
      });
    }
  };

  dossier.convergences.forEach((f, i) =>
    push("convergences", i, "supports", f.evidence_ids, f.detail),
  );
  dossier.complements.forEach((f, i) =>
    push("complements", i, "complements", f.evidence_ids, f.detail),
  );
  dossier.tensions.forEach((f, i) => push("tensions", i, "qualifies", f.evidence_ids, f.detail));
  dossier.contradictions.forEach((f, i) =>
    push("contradictions", i, "contradicts", f.evidence_ids, f.detail),
  );

  return rows;
}
