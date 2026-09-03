import { estimateTokens, pageForOffset, splitParagraphs, splitSentences } from "./text";
import type { DetectedSection } from "./structure";

export type Chunk = {
  sequence: number;
  sectionSequence: number | null;
  headingPath: string[];
  text: string;
  charStart: number;
  charEnd: number;
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number;
};

export type ChunkingOptions = {
  targetTokens?: number;
  overlapTokens?: number;
  /** Acima disso um parágrafo é quebrado por frases. */
  maxTokens?: number;
  minTokens?: number;
  pageOffsets?: number[] | null;
};

/**
 * Chunking estrutural.
 *
 * Nunca cortamos "a cada N caracteres". A ordem de respeito é:
 *   seção/capítulo -> parágrafo -> frase.
 * Um parágrafo só é dividido quando sozinho já ultrapassa o teto de tokens, e
 * mesmo assim a divisão acontece em fronteiras de frase.
 *
 * A sobreposição entre trechos é feita com as últimas frases do trecho
 * anterior, para que uma ideia partida ao meio continue legível.
 */
export function chunkDocument(
  text: string,
  sections: DetectedSection[],
  options: ChunkingOptions = {},
): Chunk[] {
  const targetTokens = options.targetTokens ?? 450;
  const overlapTokens = options.overlapTokens ?? 60;
  const maxTokens = options.maxTokens ?? Math.round(targetTokens * 1.6);
  const minTokens = options.minTokens ?? 40;
  const pageOffsets = options.pageOffsets ?? null;

  const chunks: Chunk[] = [];
  const effectiveSections: DetectedSection[] = sections.length
    ? sections
    : [
        {
          sequence: 0,
          level: 1,
          title: "Documento completo",
          headingPath: ["Documento completo"],
          charStart: 0,
          charEnd: text.length,
          pageStart: null,
          pageEnd: null,
          tokenCount: estimateTokens(text),
          parentSequence: null,
        },
      ];

  for (const section of effectiveSections) {
    const sectionText = text.slice(section.charStart, section.charEnd);
    const units = buildUnits(sectionText, section.charStart, maxTokens);

    let buffer: typeof units = [];
    let bufferTokens = 0;

    const flush = () => {
      if (buffer.length === 0) return;
      const body = buffer.map((u) => u.text).join("\n\n");
      const charStart = buffer[0].start;
      const charEnd = buffer[buffer.length - 1].end;

      chunks.push({
        sequence: chunks.length,
        sectionSequence: section.sequence,
        headingPath: section.headingPath,
        text: body,
        charStart,
        charEnd,
        pageStart: pageForOffset(pageOffsets, charStart),
        pageEnd: pageForOffset(pageOffsets, Math.max(charStart, charEnd - 1)),
        tokenCount: estimateTokens(body),
      });

      // Sobreposição: mantém o fim do trecho anterior no início do próximo.
      const overlap: typeof units = [];
      let overlapCount = 0;
      for (let i = buffer.length - 1; i >= 0 && overlapCount < overlapTokens; i -= 1) {
        overlap.unshift(buffer[i]);
        overlapCount += buffer[i].tokens;
      }
      buffer = overlapTokens > 0 && overlap.length < buffer.length ? overlap : [];
      bufferTokens = buffer.reduce((sum, u) => sum + u.tokens, 0);
    };

    for (const unit of units) {
      if (bufferTokens + unit.tokens > targetTokens && bufferTokens >= minTokens) {
        flush();
      }
      buffer.push(unit);
      bufferTokens += unit.tokens;
    }

    if (bufferTokens > 0) {
      const body = buffer.map((u) => u.text).join("\n\n");
      // Restos minúsculos são anexados ao trecho anterior da mesma seção.
      const previous = chunks[chunks.length - 1];
      if (
        estimateTokens(body) < minTokens &&
        previous &&
        previous.sectionSequence === section.sequence
      ) {
        previous.text = `${previous.text}\n\n${body}`;
        previous.charEnd = buffer[buffer.length - 1].end;
        previous.tokenCount = estimateTokens(previous.text);
        previous.pageEnd = pageForOffset(pageOffsets, Math.max(0, previous.charEnd - 1));
      } else {
        const charStart = buffer[0].start;
        const charEnd = buffer[buffer.length - 1].end;
        chunks.push({
          sequence: chunks.length,
          sectionSequence: section.sequence,
          headingPath: section.headingPath,
          text: body,
          charStart,
          charEnd,
          pageStart: pageForOffset(pageOffsets, charStart),
          pageEnd: pageForOffset(pageOffsets, Math.max(charStart, charEnd - 1)),
          tokenCount: estimateTokens(body),
        });
      }
    }
  }

  return chunks.map((chunk, index) => ({ ...chunk, sequence: index }));
}

type Unit = { text: string; start: number; end: number; tokens: number };

function buildUnits(sectionText: string, offset: number, maxTokens: number): Unit[] {
  const units: Unit[] = [];

  for (const paragraph of splitParagraphs(sectionText)) {
    const tokens = estimateTokens(paragraph.text);

    if (tokens <= maxTokens) {
      units.push({
        text: paragraph.text,
        start: offset + paragraph.start,
        end: offset + paragraph.end,
        tokens,
      });
      continue;
    }

    // Parágrafo gigante: quebra por frases, mantendo o deslocamento real.
    let cursor = paragraph.start;
    let buffer: string[] = [];
    let bufferStart = cursor;
    let bufferTokens = 0;

    for (const sentence of splitSentences(paragraph.text)) {
      const at = paragraph.text.indexOf(sentence, cursor - paragraph.start);
      const sentenceStart = at >= 0 ? paragraph.start + at : cursor;
      const sentenceTokens = estimateTokens(sentence);

      if (bufferTokens + sentenceTokens > maxTokens && buffer.length) {
        const body = buffer.join(" ");
        units.push({
          text: body,
          start: offset + bufferStart,
          end: offset + bufferStart + body.length,
          tokens: bufferTokens,
        });
        buffer = [];
        bufferTokens = 0;
        bufferStart = sentenceStart;
      }

      if (buffer.length === 0) bufferStart = sentenceStart;
      buffer.push(sentence);
      bufferTokens += sentenceTokens;
      cursor = sentenceStart + sentence.length;
    }

    if (buffer.length) {
      const body = buffer.join(" ");
      units.push({
        text: body,
        start: offset + bufferStart,
        end: offset + bufferStart + body.length,
        tokens: bufferTokens,
      });
    }
  }

  return units;
}
