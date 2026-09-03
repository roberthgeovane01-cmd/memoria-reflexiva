import { textQuality } from "./text";

export type ExtractionStatus =
  | "extracted"
  | "ocr_required"
  | "ocr_low_confidence"
  | "failed";

export type ExtractionResult = {
  engine: string;
  rawText: string;
  pageCount: number | null;
  /** Deslocamento inicial de cada página dentro de rawText. */
  pageOffsets: number[] | null;
  quality: number;
  status: ExtractionStatus;
  notes: string | null;
};

export const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
] as const;

export function detectFormat(filename: string, mimeType: string): "pdf" | "docx" | "md" | "txt" {
  const lower = filename.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (mimeType.includes("wordprocessingml") || lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || mimeType.includes("markdown"))
    return "md";
  return "txt";
}

/**
 * Extração de texto por formato.
 *
 * Princípio inegociável: se o texto extraído não for utilizável, NÃO
 * introduzimos lixo na memória. O documento fica com status `ocr_required`
 * e a interface mostra a qualidade da extração.
 */
export async function extractText(input: {
  file: Uint8Array;
  filename: string;
  mimeType: string;
}): Promise<ExtractionResult> {
  const format = detectFormat(input.filename, input.mimeType);

  switch (format) {
    case "pdf":
      return extractPdf(input.file);
    case "docx":
      return extractDocx(input.file);
    default:
      return extractPlain(input.file, format);
  }
}

async function extractPdf(file: Uint8Array): Promise<ExtractionResult> {
  const { extractText: unpdfExtract, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(file));
  const { text: pages, totalPages } = await unpdfExtract(pdf, { mergePages: false });

  const pageTexts = (pages as string[]).map((p) => p ?? "");
  const pageOffsets: number[] = [];
  let rawText = "";
  for (const pageText of pageTexts) {
    pageOffsets.push(rawText.length);
    rawText += pageText.trimEnd() + "\n\n";
  }
  rawText = rawText.trimEnd();

  const quality = textQuality(rawText);
  const charsPerPage = totalPages > 0 ? rawText.length / totalPages : 0;

  // Um PDF escaneado devolve pouquíssimo texto por página.
  if (charsPerPage < 120 || rawText.trim().length < 200) {
    return {
      engine: "unpdf",
      rawText,
      pageCount: totalPages,
      pageOffsets,
      quality,
      status: "ocr_required",
      notes:
        `Texto insuficiente: ${Math.round(charsPerPage)} caracteres por página. ` +
        `O PDF provavelmente é digitalizado e precisa de OCR antes de entrar na memória.`,
    };
  }

  if (quality < 0.55) {
    return {
      engine: "unpdf",
      rawText,
      pageCount: totalPages,
      pageOffsets,
      quality,
      status: "ocr_low_confidence",
      notes:
        `Qualidade de extração baixa (${(quality * 100).toFixed(0)}% de caracteres úteis). ` +
        `Revise o documento antes de confiar nas citações.`,
    };
  }

  return {
    engine: "unpdf",
    rawText,
    pageCount: totalPages,
    pageOffsets,
    quality,
    status: "extracted",
    notes: null,
  };
}

async function extractDocx(file: Uint8Array): Promise<ExtractionResult> {
  const imported = await import("mammoth");
  const mammoth = (imported.default ?? imported) as typeof import("mammoth");

  // Convertemos para HTML e daí para markdown: é o caminho que preserva a
  // hierarquia de títulos do DOCX, que alimenta a detecção de capítulos.
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(file) });
  const rawText = htmlToMarkdown(result.value ?? "");
  const messages = (result.messages ?? []) as Array<{ message: string }>;

  return {
    engine: "mammoth",
    rawText,
    pageCount: null,
    pageOffsets: null,
    quality: textQuality(rawText),
    status: rawText.trim().length < 50 ? "ocr_required" : "extracted",
    notes: messages.length
      ? messages
          .map((m) => m.message)
          .slice(0, 5)
          .join(" | ")
      : null,
  };
}

function extractPlain(file: Uint8Array, format: "md" | "txt"): ExtractionResult {
  const rawText = new TextDecoder("utf-8", { fatal: false }).decode(file);
  return {
    engine: format === "md" ? "markdown" : "plaintext",
    rawText,
    pageCount: null,
    pageOffsets: null,
    quality: textQuality(rawText),
    status: rawText.trim().length === 0 ? "failed" : "extracted",
    notes: null,
  };
}

/**
 * Conversão mínima de HTML para markdown.
 *
 * Só nos interessa o que alimenta a detecção de estrutura: níveis de título,
 * parágrafos e listas. Tudo o mais vira texto corrido.
 */
export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*h([1-6])[^>]*>([\s\S]*?)<\s*\/\s*h\1\s*>/gi, (_m, level: string, body: string) => {
      const title = stripTags(body).trim();
      return title ? `\n\n${"#".repeat(Number(level))} ${title}\n\n` : "\n\n";
    })
    .replace(/<\s*li[^>]*>([\s\S]*?)<\s*\/\s*li\s*>/gi, (_m, body: string) => {
      const item = stripTags(body).trim();
      return item ? `\n- ${item}` : "";
    })
    .replace(/<\s*\/\s*(p|div|section|article|ul|ol|blockquote|table|tr)\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}
