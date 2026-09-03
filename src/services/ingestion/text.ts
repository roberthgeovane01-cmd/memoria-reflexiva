import { createHash } from "node:crypto";

/** Estimativa de tokens calibrada para português (≈ 4 caracteres por token). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function sha256(data: Uint8Array | string): string {
  return createHash("sha256")
    .update(typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data))
    .digest("hex");
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Normalização conservadora.
 *
 * O texto original NUNCA é substituído — `raw_text` e `normalized_text` são
 * colunas separadas. Aqui apenas removemos ruído de extração que atrapalharia
 * o chunking: hifenização de fim de linha, quebras dentro do parágrafo,
 * espaços múltiplos e caracteres de controle.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(/\u00ad/g, "") // hífen suave
    .replace(/([A-Za-zÀ-ÿ])-\n([a-zà-ÿ])/g, "$1$2") // "presen-\nça" -> "presença"
    .replace(/([^\n])\n(?!\n)(?=[a-zà-ÿ(«"'])/g, "$1 ") // junta linhas do mesmo parágrafo
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Divide em parágrafos preservando o deslocamento de caracteres no texto. */
export function splitParagraphs(text: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  const regex = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const value = match[0].trim();
    if (value) out.push({ text: value, start: match.index, end: match.index + match[0].length });
  }
  return out;
}

const ABBREVIATIONS =
  /\b(Sr|Sra|Srta|Dr|Dra|Prof|Profa|St|Sta|pág|págs|p|pp|cap|caps|ed|org|etc|ex|vol|fl|art|séc|n)\.(\s)/gi;
const DOT_PLACEHOLDER = "\u0000";

/** Divisão em frases, tolerante a abreviações comuns em português. */
export function splitSentences(text: string): string[] {
  const masked = text.replace(ABBREVIATIONS, (_m, word, space) => `${word}${DOT_PLACEHOLDER}${space}`);
  return masked
    .split(/(?<=[.!?…])\s+(?=[A-ZÀ-Þ"'«(—])/)
    .map((s) => s.split(DOT_PLACEHOLDER).join(".").trim())
    .filter(Boolean);
}

/** Converte um deslocamento de caractere no número da página correspondente. */
export function pageForOffset(pageOffsets: number[] | null, offset: number): number | null {
  if (!pageOffsets || pageOffsets.length === 0) return null;
  let low = 0;
  let high = pageOffsets.length - 1;
  let page = 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (pageOffsets[mid] <= offset) {
      page = mid + 1;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return page;
}

/** Proporção de caracteres "úteis" — usada para detectar extração ruim. */
export function textQuality(text: string): number {
  if (!text) return 0;
  const letters = (text.match(/[A-Za-zÀ-ÿ0-9]/g) ?? []).length;
  return letters / text.length;
}
