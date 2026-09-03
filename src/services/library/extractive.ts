import { splitSentences } from "@/services/ingestion/text";
import { stem, tokenize } from "@/ai/providers/mock";
import type { ClaimExtraction, ConceptExtraction, Summary } from "@/ai/schemas";

/**
 * Derivações EXTRATIVAS, usadas quando não há modelo de linguagem disponível.
 *
 * Nada aqui é inventado: resumos são frases reais do texto, conceitos são
 * termos que de fato ocorrem, e cada afirmação carrega a citação literal de
 * onde veio. É honesto chamar isso de "modo demonstração" — não é honesto
 * chamar de "a IA analisou".
 */

function scoreSentences(text: string): Array<{ sentence: string; score: number; index: number }> {
  const sentences = splitSentences(text);
  const frequency = new Map<string, number>();

  for (const sentence of sentences) {
    for (const token of tokenize(sentence)) {
      const key = stem(token);
      frequency.set(key, (frequency.get(key) ?? 0) + 1);
    }
  }

  return sentences.map((sentence, index) => {
    const tokens = tokenize(sentence).map(stem);
    if (tokens.length === 0) return { sentence, score: 0, index };
    const raw = tokens.reduce((sum, t) => sum + (frequency.get(t) ?? 0), 0) / tokens.length;
    // Frases muito curtas ou muito longas raramente resumem bem.
    const lengthPenalty = tokens.length < 6 || tokens.length > 60 ? 0.5 : 1;
    // Abertura e fechamento costumam concentrar a tese.
    const positionBonus = index < 3 || index >= sentences.length - 2 ? 1.15 : 1;
    return { sentence, score: raw * lengthPenalty * positionBonus, index };
  });
}

export function extractiveSummary(text: string, maxSentences = 5): Summary {
  const scored = scoreSentences(text);
  const chosen = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.sentence);

  const summary = chosen.join(" ").trim();
  const themes = topTerms(text, 8);

  return {
    summary:
      summary ||
      "[modo demonstração] Não foi possível resumir automaticamente: o texto é curto demais.",
    key_points: chosen.slice(0, 5),
    themes,
  };
}

export function topTerms(text: string, limit: number): string[] {
  const frequency = new Map<string, { count: number; sample: string }>();
  for (const token of tokenize(text)) {
    const key = stem(token);
    if (key.length < 4) continue;
    const current = frequency.get(key);
    if (current) current.count += 1;
    else frequency.set(key, { count: 1, sample: token });
  }
  return [...frequency.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([, v]) => v.sample);
}

export function extractiveConcepts(text: string, limit = 12): ConceptExtraction {
  const terms = topTerms(text, limit);
  const total = Math.max(1, tokenize(text).length);
  return {
    concepts: terms.map((label, index) => ({
      label,
      definition: null,
      aliases: [],
      confidence: Math.max(0.15, Math.min(0.6, (limit - index) / limit - 0.2 + 40 / total)),
    })),
  };
}

export function extractiveClaims(text: string, limit = 5): ClaimExtraction {
  const scored = scoreSentences(text)
    .filter((s) => s.sentence.length > 45 && /[.!?…]$/.test(s.sentence.trim()))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    claims: scored.map((s) => ({
      text: s.sentence.trim(),
      kind: "assertion" as const,
      polarity: "affirmative" as const,
      // A citação é literalmente a frase do texto — rastreabilidade preservada.
      quote: s.sentence.trim(),
      confidence: 0.3,
    })),
  };
}
