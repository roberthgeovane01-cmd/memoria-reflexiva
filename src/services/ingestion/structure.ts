import { estimateTokens, pageForOffset } from "./text";

export type DetectedSection = {
  sequence: number;
  level: number;
  title: string;
  headingPath: string[];
  charStart: number;
  charEnd: number;
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number;
  parentSequence: number | null;
};

export type StructureResult = {
  status: "detected" | "flat";
  sections: DetectedSection[];
};

type Heading = { level: number; title: string; index: number; length: number };

const MARKDOWN_HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const CHAPTER_WORDS =
  /^\s*(cap[íi]tulo|parte|se[çc][ãa]o|livro|t[íi]tulo|ato|prefácio|prefacio|introdu[çc][ãa]o|conclus[ãa]o|ep[íi]logo|pr[óo]logo|posf[áa]cio|ap[êe]ndice|anexo|nota[s]? do autor|sum[áa]rio)\b/i;
const NUMBERED = /^\s*(\d{1,3})[.)–-]\s+\S/;
const ROMAN = /^\s*([IVXLCDM]{1,7})[.)–-]?\s*$/;

/**
 * Detecção de estrutura.
 *
 * Ordem de preferência:
 *   1. títulos markdown (vindos de DOCX convertido ou de arquivos .md);
 *   2. palavras estruturais em português ("Capítulo", "Parte", "Prefácio"…);
 *   3. linhas curtas isoladas em caixa alta ou numeradas.
 *
 * Se nada disso aparecer, o documento é tratado como `flat`: uma única seção.
 * Nunca inventamos capítulos que não existem.
 */
export function detectSections(
  text: string,
  pageOffsets: number[] | null = null,
): StructureResult {
  const headings = findHeadings(text);

  if (headings.length < 2) {
    return {
      status: "flat",
      sections: [
        {
          sequence: 0,
          level: 1,
          title: "Documento completo",
          headingPath: ["Documento completo"],
          charStart: 0,
          charEnd: text.length,
          pageStart: pageForOffset(pageOffsets, 0),
          pageEnd: pageForOffset(pageOffsets, Math.max(0, text.length - 1)),
          tokenCount: estimateTokens(text),
          parentSequence: null,
        },
      ],
    };
  }

  const sections: DetectedSection[] = [];

  // Texto antes do primeiro título vira uma seção de abertura, se relevante.
  if (headings[0].index > 400) {
    sections.push({
      sequence: 0,
      level: 1,
      title: "Abertura",
      headingPath: ["Abertura"],
      charStart: 0,
      charEnd: headings[0].index,
      pageStart: pageForOffset(pageOffsets, 0),
      pageEnd: pageForOffset(pageOffsets, headings[0].index),
      tokenCount: estimateTokens(text.slice(0, headings[0].index)),
      parentSequence: null,
    });
  }

  const stack: DetectedSection[] = [];

  headings.forEach((heading, i) => {
    const charStart = heading.index;
    const charEnd = i + 1 < headings.length ? headings[i + 1].index : text.length;

    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
    const parent = stack[stack.length - 1] ?? null;

    const section: DetectedSection = {
      sequence: sections.length,
      level: heading.level,
      title: heading.title,
      headingPath: [...(parent?.headingPath ?? []), heading.title],
      charStart,
      charEnd,
      pageStart: pageForOffset(pageOffsets, charStart),
      pageEnd: pageForOffset(pageOffsets, Math.max(charStart, charEnd - 1)),
      tokenCount: estimateTokens(text.slice(charStart, charEnd)),
      parentSequence: parent ? parent.sequence : null,
    };

    sections.push(section);
    stack.push(section);
  });

  return { status: "detected", sections };
}

function findHeadings(text: string): Heading[] {
  const markdown = findMarkdownHeadings(text);
  if (markdown.length >= 2) return markdown;

  const structural = findStructuralHeadings(text);
  return structural;
}

function findMarkdownHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const match = MARKDOWN_HEADING.exec(line);
    if (match) {
      out.push({
        level: match[1].length,
        title: match[2].trim(),
        index: offset,
        length: line.length,
      });
    }
    offset += line.length + 1;
  }
  return out;
}

function findStructuralHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  const lines = text.split("\n");
  let offset = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const next = (lines[i + 1] ?? "").trim();
    const previous = (lines[i - 1] ?? "").trim();
    const isolated = previous === "" || i === 0;

    if (trimmed.length > 0 && trimmed.length <= 120 && isolated && next !== "") {
      let level: number | null = null;

      if (CHAPTER_WORDS.test(trimmed)) level = 1;
      else if (ROMAN.test(trimmed)) level = 1;
      else if (NUMBERED.test(trimmed) && trimmed.length <= 90) level = 2;
      else if (
        trimmed.length <= 70 &&
        !/[.;:!?]$/.test(trimmed) &&
        trimmed === trimmed.toUpperCase() &&
        /[A-ZÀ-Þ]/.test(trimmed)
      ) {
        level = 1;
      }

      if (level !== null) {
        out.push({ level, title: trimmed, index: offset, length: line.length });
      }
    }
    offset += line.length + 1;
  }

  // Um "capítulo" a cada duas linhas é ruído de extração, não estrutura.
  if (out.length > 1 && text.length / out.length < 400) return [];
  return out;
}
