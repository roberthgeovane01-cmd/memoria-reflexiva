import { stem, tokenize } from "@/ai/providers/mock";
import type {
  ConflictAnalysis,
  EvidenceClassification,
  MemoryDossier,
} from "@/ai/schemas";
import type { EvidenceItem } from "@/services/retrieval/engine";
import { truncate } from "@/lib/utils";

/**
 * Análise sem modelo de linguagem (modo demonstração).
 *
 * As heurísticas aqui são deliberadamente conservadoras: preferem classificar
 * como "complements" a inventar uma contradição, e só marcam conflito factual
 * quando há divergência objetiva de número ou data. Um sistema que erra para o
 * lado de "não sei" é melhor do que um que erra para o lado de "eu lembro".
 */

const NEGATION = /\b(n[ãa]o|nunca|jamais|nenhum|nenhuma|sem|tampouco|exceto|salvo)\b/i;
const CONDITIONAL = /\b(mas|por[ée]m|contudo|entretanto|todavia|embora|apesar|desde que|a menos)\b/i;

export function overlapRatio(a: string, b: string): number {
  const left = new Set(tokenize(a).map(stem));
  const right = new Set(tokenize(b).map(stem));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

export function extractYears(text: string): number[] {
  return [...text.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
}

export function extractDatesPt(text: string): string[] {
  const months =
    "janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";
  const regex = new RegExp(`\\b(?:\\d{1,2}\\s+de\\s+)?(?:${months})(?:\\s+de\\s+(?:19|20)\\d{2})?\\b`, "gi");
  return [...text.matchAll(regex)].map((m) => m[0].toLowerCase());
}

export function heuristicEvidenceClassification(
  speech: string,
  evidence: EvidenceItem[],
): EvidenceClassification {
  return {
    classifications: evidence.map((item) => {
      const ratio = overlapRatio(speech, item.text);
      const speechNegated = NEGATION.test(speech);
      const evidenceNegated = NEGATION.test(item.text);
      const polarityClash = speechNegated !== evidenceNegated;

      let classification: EvidenceClassification["classifications"][number]["classification"];
      let rationale: string;

      if (ratio < 0.08) {
        classification = "unrelated";
        rationale = "Sobreposição de vocabulário muito baixa com a fala atual.";
      } else if (polarityClash && ratio > 0.25) {
        classification = "contradicts";
        rationale =
          "Trata do mesmo assunto com polaridade invertida (um afirma, o outro nega).";
      } else if (CONDITIONAL.test(item.text) && ratio > 0.15) {
        classification = "qualifies";
        rationale = "Trata do assunto impondo uma ressalva ou condição.";
      } else if (ratio > 0.3) {
        classification = "supports";
        rationale = "Vocabulário e assunto muito próximos do que foi dito.";
      } else {
        classification = "complements";
        rationale = "Assunto relacionado, abordado por outro ângulo.";
      }

      return {
        evidence_id: item.hitId,
        classification,
        rationale: `[modo demonstração] ${rationale}`,
        confidence: Math.min(0.6, 0.2 + ratio),
      };
    }),
  };
}

export function heuristicConflictAnalysis(
  speech: string,
  evidence: EvidenceItem[],
  classifications: EvidenceClassification,
): ConflictAnalysis {
  const conflicts: ConflictAnalysis["conflicts"] = [];
  const byId = new Map(evidence.map((e) => [e.hitId, e]));

  // 1. Conflito factual: anos diferentes para o mesmo assunto.
  const speechYears = new Set(extractYears(speech));
  if (speechYears.size > 0) {
    for (const item of evidence) {
      const years = extractYears(item.text);
      const divergent = years.filter((y) => !speechYears.has(y));
      if (divergent.length > 0 && overlapRatio(speech, item.text) > 0.2) {
        conflicts.push({
          kind: "factual_conflict",
          severity: "high",
          title: `Divergência de data com "${item.sourceTitle}"`,
          description:
            `A fala menciona ${[...speechYears].join(", ")} e o registro recuperado ` +
            `menciona ${divergent.join(", ")} tratando do mesmo assunto. ` +
            `O sistema não corrige sozinho: a decisão é sua.`,
          speech_excerpt: truncate(speech, 300),
          memory_excerpt: truncate(item.text, 300),
          evidence_ids: [item.hitId],
          confidence: 0.55,
        });
      }
    }
  }

  // 2. Divergência interpretativa: evidências classificadas como contradição.
  for (const classification of classifications.classifications) {
    if (classification.classification !== "contradicts") continue;
    const item = byId.get(classification.evidence_id);
    if (!item) continue;
    conflicts.push({
      kind: "interpretive_divergence",
      severity: "medium",
      title: `Registro anterior trata o tema de outra forma — "${item.sourceTitle}"`,
      description:
        "Foram encontrados registros anteriores que tratam o tema de forma diferente " +
        "do que foi dito agora. Isso não significa que a fala esteja errada.",
      speech_excerpt: truncate(speech, 300),
      memory_excerpt: truncate(item.text, 300),
      evidence_ids: [item.hitId],
      confidence: classification.confidence,
    });
  }

  // 3. Conflito entre fontes: duas fontes de autoridade alta com polaridade
  //    oposta sobre o mesmo assunto.
  for (let i = 0; i < evidence.length; i += 1) {
    for (let j = i + 1; j < evidence.length; j += 1) {
      const a = evidence[i];
      const b = evidence[j];
      if (!a.sourceId || !b.sourceId || a.sourceId === b.sourceId) continue;
      const similar = overlapRatio(a.text, b.text);
      if (similar < 0.35) continue;
      if (NEGATION.test(a.text) === NEGATION.test(b.text)) continue;

      conflicts.push({
        kind: "source_conflict",
        severity: "medium",
        title: `"${a.sourceTitle}" e "${b.sourceTitle}" divergem`,
        description:
          "Duas fontes da biblioteca tratam do mesmo ponto de maneiras incompatíveis. " +
          "Nenhuma foi escolhida como vencedora: as duas continuam no dossiê.",
        speech_excerpt: truncate(a.text, 250),
        memory_excerpt: truncate(b.text, 250),
        evidence_ids: [a.hitId, b.hitId],
        confidence: Math.min(0.5, similar),
      });
    }
  }

  return { conflicts: conflicts.slice(0, 12) };
}

export function heuristicDossier(
  centralQuestion: string,
  speech: string,
  evidence: EvidenceItem[],
  classifications: EvidenceClassification,
): MemoryDossier {
  const byId = new Map(evidence.map((e) => [e.hitId, e]));
  const group = (kind: string) =>
    classifications.classifications
      .filter((c) => c.classification === kind)
      .map((c) => ({ classification: c, item: byId.get(c.evidence_id) }))
      .filter((entry): entry is { classification: typeof entry.classification; item: EvidenceItem } =>
        Boolean(entry.item),
      );

    const toFinding = (entries: ReturnType<typeof group>) =>
      entries.slice(0, 6).map((entry) => ({
        statement: `${entry.item.sourceTitle}: ${truncate(entry.item.text, 160)}`,
        detail: entry.classification.rationale,
        evidence_ids: [entry.item.hitId],
        source_ids: entry.item.sourceId ? [entry.item.sourceId] : [],
      }));

  const supports = group("supports");
  const complements = group("complements");
  const qualifies = group("qualifies");
  const contradicts = group("contradicts");
  const relevant = supports.length + complements.length + qualifies.length + contradicts.length;

  const sources = new Map<string, { id: string; title: string; count: number }>();
  for (const item of evidence) {
    if (!item.sourceId) continue;
    const current = sources.get(item.sourceId);
    if (current) current.count += 1;
    else sources.set(item.sourceId, { id: item.sourceId, title: item.sourceTitle, count: 1 });
  }

  const hasMemory = relevant > 0;

  return {
    central_question: centralQuestion,
    has_memory: hasMemory,
    executive_summary: hasMemory
      ? `[modo demonstração] A biblioteca tem ${relevant} trecho(s) relacionados a esta questão, ` +
        `vindos de ${sources.size} fonte(s). ${supports.length} sustentam o que foi dito, ` +
        `${complements.length} acrescentam outro ângulo, ${qualifies.length} impõem ressalva e ` +
        `${contradicts.length} divergem. Esta síntese foi montada por regras, não por um modelo ` +
        `de linguagem: configure uma chave de IA para obter a análise completa.`
      : "Não há memória suficiente na biblioteca para sustentar uma investigação sobre este " +
        "assunto. Nenhuma evidência relevante foi encontrada. O sistema não vai simular " +
        "lembrança: escreva a partir da sua fala, ou adicione material à biblioteca.",
    convergences: toFinding(supports),
    complements: toFinding(complements),
    tensions: toFinding(qualifies),
    contradictions: toFinding(contradicts),
    temporal_evolution: [],
    related_episodes: evidence
      .filter((e) => e.ownerKind === "episode")
      .slice(0, 6)
      .map((e) => ({ episode_id: e.ownerId, relation: "Relato anterior sobre assunto próximo" })),
    knowledge_gaps: hasMemory
      ? [
          "Esta síntese foi produzida por heurística; lacunas conceituais não foram avaliadas.",
        ]
      : [`A biblioteca não cobre: ${truncate(speech, 120)}`],
    central_sources: [...sources.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((s) => ({ source_id: s.id, why: `${s.count} trecho(s) recuperados desta fonte` })),
    editorial_notes: hasMemory
      ? ["Modo demonstração: confirme as evidências antes de aprovar a reflexão."]
      : ["Sem memória: a reflexão deve declarar a ausência em vez de simular lembrança."],
  };
}
