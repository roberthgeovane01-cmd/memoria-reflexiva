import { describe, expect, it } from "vitest";
import { chunkDocument } from "@/services/ingestion/chunking";
import { detectSections } from "@/services/ingestion/structure";
import {
  estimateTokens,
  normalizeText,
  sha256,
  splitParagraphs,
  splitSentences,
} from "@/services/ingestion/text";

const LIVRO = `# A Permanência

## Capítulo 1 — Ficar

Permanecer não é resolver. Há situações em que a única coisa honesta a fazer é
ficar por perto sem tentar consertar nada.

A pressa de resolver costuma ser um jeito educado de ir embora. Quem resolve
rápido às vezes está apenas fugindo do desconforto de acompanhar.

## Capítulo 2 — O silêncio

O silêncio de quem fica é diferente do silêncio de quem se ausenta. Um sustenta,
o outro abandona.

Nem todo silêncio é omissão. Existe uma forma de calar que é presença inteira.`;

describe("normalização de texto", () => {
  it("reconstrói palavras hifenizadas na quebra de linha", () => {
    expect(normalizeText("a presen-\nça basta")).toBe("a presença basta");
  });

  it("junta linhas soltas do mesmo parágrafo mas preserva parágrafos", () => {
    const result = normalizeText("primeira linha\ncontinua aqui\n\nsegundo parágrafo");
    expect(result).toBe("primeira linha continua aqui\n\nsegundo parágrafo");
  });

  it("colapsa quebras excessivas", () => {
    expect(normalizeText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("hash de conteúdo", () => {
  it("é determinístico e sensível a qualquer mudança", () => {
    expect(sha256("permanecer")).toBe(sha256("permanecer"));
    expect(sha256("permanecer")).not.toBe(sha256("permanecer."));
    expect(sha256("permanecer")).toHaveLength(64);
  });
});

describe("divisão em frases", () => {
  it("não quebra em abreviações comuns", () => {
    const frases = splitSentences("Segundo o Dr. Silva, permanecer basta. Nada mais.");
    expect(frases).toHaveLength(2);
    expect(frases[0]).toContain("Dr. Silva");
  });
});

describe("detecção de estrutura", () => {
  it("encontra os capítulos de um markdown", () => {
    const { status, sections } = detectSections(normalizeText(LIVRO));
    expect(status).toBe("detected");
    const titulos = sections.map((s) => s.title);
    expect(titulos).toContain("A Permanência");
    expect(titulos.some((t) => t.includes("Ficar"))).toBe(true);
    expect(titulos.some((t) => t.includes("silêncio"))).toBe(true);
  });

  it("monta o caminho hierárquico do título", () => {
    const { sections } = detectSections(normalizeText(LIVRO));
    const capitulo = sections.find((s) => s.title.includes("Ficar"));
    expect(capitulo?.headingPath[0]).toBe("A Permanência");
    expect(capitulo?.level).toBe(2);
  });

  it("trata como documento único quando não há estrutura", () => {
    const { status, sections } = detectSections("Uma frase solta. E outra.");
    expect(status).toBe("flat");
    expect(sections).toHaveLength(1);
  });

  it("ignora falsa estrutura de PDF mal extraído", () => {
    const ruido = Array.from({ length: 40 }, (_, i) => `LINHA ${i}\nconteudo curto`).join("\n\n");
    const { status } = detectSections(ruido);
    expect(status).toBe("flat");
  });
});

describe("chunking estrutural", () => {
  const texto = normalizeText(LIVRO);
  const { sections } = detectSections(texto);

  it("nunca produz trechos vazios", () => {
    const chunks = chunkDocument(texto, sections, { targetTokens: 60, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text.trim().length).toBeGreaterThan(0);
  });

  it("mantém cada trecho dentro de uma única seção", () => {
    const chunks = chunkDocument(texto, sections, { targetTokens: 60, overlapTokens: 10 });
    for (const chunk of chunks) {
      const secao = sections.find((s) => s.sequence === chunk.sectionSequence);
      expect(secao).toBeDefined();
      expect(chunk.charStart).toBeGreaterThanOrEqual(secao!.charStart);
      expect(chunk.charEnd).toBeLessThanOrEqual(secao!.charEnd + 1);
    }
  });

  it("numera os trechos em sequência contínua", () => {
    const chunks = chunkDocument(texto, sections, { targetTokens: 60, overlapTokens: 10 });
    chunks.forEach((chunk, index) => expect(chunk.sequence).toBe(index));
  });

  it("não corta no meio de um parágrafo quando ele cabe no trecho", () => {
    const chunks = chunkDocument(texto, sections, { targetTokens: 400, overlapTokens: 0 });
    const paragrafos = splitParagraphs(texto).map((p) => p.text);
    const paragrafoInteiro = paragrafos.find((p) => p.includes("A pressa de resolver"));
    expect(paragrafoInteiro).toBeDefined();
    expect(chunks.some((c) => c.text.includes(paragrafoInteiro!))).toBe(true);
  });

  it("quebra parágrafos gigantes em fronteiras de frase", () => {
    const frase = "Permanecer é uma decisão que se renova todo dia. ";
    const gigante = `# Único\n\n${frase.repeat(120)}`;
    const normalizado = normalizeText(gigante);
    const chunks = chunkDocument(normalizado, detectSections(normalizado).sections, {
      targetTokens: 120,
      overlapTokens: 0,
      maxTokens: 150,
    });
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(400);
      expect(chunk.text).not.toMatch(/renova todo$/);
    }
  });

  it("aplica sobreposição entre trechos vizinhos da mesma seção", () => {
    const paragrafos = Array.from(
      { length: 12 },
      (_, i) => `Parágrafo número ${i} sobre permanência e presença em situações difíceis.`,
    ).join("\n\n");
    const doc = normalizeText(`# Título\n\n${paragrafos}`);
    const chunks = chunkDocument(doc, detectSections(doc).sections, {
      targetTokens: 60,
      overlapTokens: 25,
      minTokens: 10,
    });
    expect(chunks.length).toBeGreaterThan(2);
    // O fim de um trecho reaparece no começo do seguinte: uma ideia partida ao
    // meio continua legível quando recuperada isoladamente.
    const primeiroFim = chunks[0].text.split("\n\n").at(-1)!;
    expect(chunks[1].text).toContain(primeiroFim);
    expect(chunks[1].text.indexOf(primeiroFim)).toBeLessThan(chunks[1].text.length / 2);
    expect(chunks[1].charStart).toBeLessThan(chunks[0].charEnd);
  });

  it("estima tokens de forma monotônica", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});
