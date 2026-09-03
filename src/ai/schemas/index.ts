import { z } from "zod";

/**
 * Schemas de saída estruturada.
 *
 * Toda tarefa analítica devolve JSON validado por Zod. Nunca dependemos de
 * "parsing" frágil de texto livre. Campos que podem faltar usam `.nullable()`
 * (e não `.optional()`) porque é a forma suportada pelo modo estrito de
 * Structured Outputs.
 */

export const EvidenceRefSchema = z.object({
  /** Identificador do resultado recuperado (retrieval_hits.id). */
  evidence_id: z.string(),
  /** Citação literal do trecho — não pode ser parafraseada. */
  quote: z.string().nullable(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

// --------------------------------------------------------------------------
// 1. Query Planner
// --------------------------------------------------------------------------

export const QueryPlanSchema = z.object({
  central_question: z.string(),
  intent: z.enum([
    "compreender",
    "decidir",
    "lembrar",
    "comparar",
    "elaborar",
    "registrar",
    "outro",
  ]),
  themes: z.array(z.string()).max(12),
  entities: z.array(z.string()).max(20),
  claims: z.array(z.string()).max(12),
  contrasts: z.array(z.string()).max(8),
  temporal_references: z.array(
    z.object({
      expression: z.string(),
      normalized: z.string().nullable(),
    }),
  ).max(8),
  queries: z
    .array(
      z.object({
        text: z.string(),
        rationale: z.string(),
        level: z.enum(["global", "section", "evidence", "direct"]),
      }),
    )
    .min(1)
    .max(12),
});
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

// --------------------------------------------------------------------------
// 2. Extração de conceitos
// --------------------------------------------------------------------------

export const ConceptExtractionSchema = z.object({
  concepts: z
    .array(
      z.object({
        label: z.string(),
        definition: z.string().nullable(),
        aliases: z.array(z.string()).max(5),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(25),
});
export type ConceptExtraction = z.infer<typeof ConceptExtractionSchema>;

// --------------------------------------------------------------------------
// 3. Extração de afirmações (claims)
// --------------------------------------------------------------------------

export const ClaimExtractionSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string(),
        kind: z.enum([
          "assertion",
          "definition",
          "principle",
          "observation",
          "prescription",
          "question",
        ]),
        polarity: z.enum(["affirmative", "negative", "conditional"]),
        quote: z.string(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(20),
});
export type ClaimExtraction = z.infer<typeof ClaimExtractionSchema>;

// --------------------------------------------------------------------------
// 4. Classificação de evidências
// --------------------------------------------------------------------------

export const EvidenceClassificationSchema = z.object({
  classifications: z.array(
    z.object({
      evidence_id: z.string(),
      classification: z.enum([
        "supports",
        "complements",
        "contradicts",
        "qualifies",
        "unrelated",
      ]),
      rationale: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type EvidenceClassification = z.infer<typeof EvidenceClassificationSchema>;

// --------------------------------------------------------------------------
// 5. Análise de conflitos
// --------------------------------------------------------------------------

export const ConflictAnalysisSchema = z.object({
  conflicts: z
    .array(
      z.object({
        kind: z.enum([
          "complement",
          "minor_divergence",
          "factual_conflict",
          "interpretive_divergence",
          "source_conflict",
        ]),
        severity: z.enum(["low", "medium", "high"]),
        title: z.string(),
        description: z.string(),
        speech_excerpt: z.string().nullable(),
        memory_excerpt: z.string().nullable(),
        evidence_ids: z.array(z.string()).max(6),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(12),
});
export type ConflictAnalysis = z.infer<typeof ConflictAnalysisSchema>;

// --------------------------------------------------------------------------
// 6. Dossiê de memória
// --------------------------------------------------------------------------

const FindingSchema = z.object({
  statement: z.string(),
  detail: z.string(),
  evidence_ids: z.array(z.string()).min(1).max(8),
  source_ids: z.array(z.string()).max(8),
});

export const MemoryDossierSchema = z.object({
  central_question: z.string(),
  executive_summary: z.string(),
  has_memory: z.boolean(),
  convergences: z.array(FindingSchema).max(8),
  complements: z.array(FindingSchema).max(8),
  tensions: z.array(FindingSchema).max(8),
  contradictions: z.array(FindingSchema).max(8),
  temporal_evolution: z
    .array(
      z.object({
        period: z.string(),
        statement: z.string(),
        evidence_ids: z.array(z.string()).max(6),
      }),
    )
    .max(6),
  related_episodes: z
    .array(
      z.object({
        episode_id: z.string(),
        relation: z.string(),
      }),
    )
    .max(8),
  knowledge_gaps: z.array(z.string()).max(8),
  central_sources: z
    .array(
      z.object({
        source_id: z.string(),
        why: z.string(),
      }),
    )
    .max(8),
  editorial_notes: z.array(z.string()).max(6),
});
export type MemoryDossier = z.infer<typeof MemoryDossierSchema>;

// --------------------------------------------------------------------------
// 7. Análise de estilo
// --------------------------------------------------------------------------

export const StyleAnalysisSchema = z.object({
  tone: z.string(),
  rhythm: z.string(),
  structure: z.string(),
  perspective: z.string(),
  poeticity: z.number().int().min(0).max(5),
  metaphor_level: z.number().int().min(0).max(5),
  vocabulary_notes: z.string(),
  preferred_expressions: z.array(z.string()).max(20),
  forbidden_expressions: z.array(z.string()).max(20),
  guidelines: z.string(),
});
export type StyleAnalysis = z.infer<typeof StyleAnalysisSchema>;

// --------------------------------------------------------------------------
// 8. Resumo de fonte
// --------------------------------------------------------------------------

export const SummarySchema = z.object({
  summary: z.string(),
  key_points: z.array(z.string()).max(10),
  themes: z.array(z.string()).max(10),
});
export type Summary = z.infer<typeof SummarySchema>;

// --------------------------------------------------------------------------
// 9. Episódio (memória episódica)
// --------------------------------------------------------------------------

export const EpisodeSchema = z.object({
  title: z.string(),
  summary: z.string(),
  occurred_on: z.string().nullable(),
  temporality: z.string().nullable(),
  themes: z.array(z.string()).max(10),
  entities: z
    .array(z.object({ name: z.string(), kind: z.string() }))
    .max(15),
  projects: z.array(z.string()).max(8),
});
export type Episode = z.infer<typeof EpisodeSchema>;

// --------------------------------------------------------------------------
// 10. Reflexão escrita
// --------------------------------------------------------------------------

export const ReflectionOutputSchema = z.object({
  title: z.string(),
  text: z.string(),
  used_evidence_ids: z.array(z.string()).max(30),
  declared_gaps: z.array(z.string()).max(6),
});
export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;
