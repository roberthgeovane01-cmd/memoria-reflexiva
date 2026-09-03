import { createHash } from "node:crypto";
import type {
  EmbeddingProvider,
  OcrResult,
  LanguageModelProvider,
  OcrProvider,
  ProviderUsage,
  RerankCandidate,
  RerankResult,
  RerankingProvider,
  SpeechToTextProvider,
  StructuredRequest,
  TextRequest,
  TextToSpeechProvider,
  WithUsage,
} from "./types";

/**
 * Providers de MODO DEMONSTRAÇÃO.
 *
 * Não são stubs vazios: o embedding mock é um *hashing vectorizer* real, então
 * textos parecidos produzem vetores parecidos e a busca semântica continua
 * fazendo sentido sem nenhuma chave de IA. Isso permite desenvolver, testar e
 * demonstrar o aplicativo inteiro offline.
 */

function usage(provider: string, model: string, startedAt: number): ProviderUsage {
  return { provider, model, latencyMs: Date.now() - startedAt, demo: true };
}

// --------------------------------------------------------------------------
// Tokenização compartilhada (mesma normalização do índice FTS em português)
// --------------------------------------------------------------------------

const STOPWORDS = new Set(
  (
    "a o e de da do das dos em no na nos nas um uma uns umas para por com sem sobre " +
    "que se ao aos as os à às ou como mais mas nem já muito muita pouco pouca ser " +
    "estar tem ter foi era são eu você ele ela nós eles elas isso isto aquilo meu " +
    "minha seu sua este esta esse essa pelo pela entre até quando onde porque"
  )
    .split(" ")
    .filter(Boolean),
);

export function normalizeForTokens(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function tokenize(text: string): string[] {
  return normalizeForTokens(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Radical grosseiro em português: corta plurais e sufixos comuns. */
export function stem(token: string): string {
  return token
    .replace(/(mente|acoes|acao|ancia|encia|idade|amento|imento|ismo|ista)$/u, "")
    .replace(/(coes|oes|aes|res|ns|s)$/u, "")
    .replace(/(ando|endo|indo|ar|er|ir)$/u, "");
}

function hashIndex(token: string, dimensions: number): number {
  const digest = createHash("sha1").update(token).digest();
  return digest.readUInt32BE(0) % dimensions;
}

function hashSign(token: string): 1 | -1 {
  const digest = createHash("sha1").update(`sign:${token}`).digest();
  return (digest[0] & 1) === 0 ? 1 : -1;
}

/**
 * Hashing vectorizer com pesos sublineares e assinatura de sinal (reduz colisão).
 * Cada token conta pelo radical e pela forma completa, o que aproxima variações
 * morfológicas ("permanecer" / "permanência") sem nenhum modelo treinado.
 */
export function hashingEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const counts = new Map<string, number>();

  for (const raw of tokenize(text)) {
    for (const form of [raw, stem(raw)]) {
      if (!form) continue;
      counts.set(form, (counts.get(form) ?? 0) + (form === raw ? 1 : 0.6));
    }
  }

  for (const [token, count] of counts) {
    const weight = (1 + Math.log(count)) * hashSign(token);
    vector[hashIndex(token, dimensions)] += weight;
  }

  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) {
    // Vetor nulo quebraria a distância de cosseno; devolve um vetor estável.
    vector[0] = 1;
    return vector;
  }
  return vector.map((v) => v / norm);
}

// --------------------------------------------------------------------------

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";
  readonly isDemo = true;
  constructor(
    readonly model = "deterministic-hash-1536",
    readonly dimensions = 1536,
  ) {}

  async embed(texts: string[]): Promise<WithUsage<number[][]>> {
    const startedAt = Date.now();
    return {
      value: texts.map((t) => hashingEmbedding(t, this.dimensions)),
      usage: usage(this.name, this.model, startedAt),
    };
  }
}

// --------------------------------------------------------------------------

export class MockLanguageModelProvider implements LanguageModelProvider {
  readonly name = "mock";
  readonly isDemo = true;

  async generateStructured<T>(request: StructuredRequest<T>): Promise<WithUsage<T>> {
    const startedAt = Date.now();
    // O fallback determinístico é definido por quem chama, com base nas
    // evidências reais recuperadas — nunca em fatos inventados.
    const value = request.schema.parse(request.demoFallback());
    return { value, usage: usage(this.name, request.model ?? "demo", startedAt) };
  }

  async generateText(request: TextRequest): Promise<WithUsage<string>> {
    const startedAt = Date.now();
    return {
      value: request.demoFallback(),
      usage: usage(this.name, request.model ?? "demo", startedAt),
    };
  }
}

// --------------------------------------------------------------------------

export class MockSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "mock";
  readonly model = "demo-transcriber";
  readonly isDemo = true;

  async transcribe(input: { filename: string }) {
    const startedAt = Date.now();
    return {
      value: {
        text:
          "[MODO DEMONSTRAÇÃO] A transcrição automática está desligada porque " +
          "nenhuma chave de transcrição foi configurada. Escreva ou cole aqui o " +
          `texto do áudio "${input.filename}" e siga normalmente: a revisão ` +
          "humana da transcrição já faz parte do fluxo.",
        language: "pt-BR",
        confidence: null,
        segments: [],
      },
      usage: usage(this.name, this.model, startedAt),
    };
  }
}

// --------------------------------------------------------------------------

/** Gera um WAV silencioso válido, para que o fluxo de voz possa ser testado. */
function silentWav(seconds: number): Uint8Array {
  const sampleRate = 8000;
  const samples = Math.max(1, Math.round(sampleRate * seconds));
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return new Uint8Array(buffer);
}

export class MockTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = "mock";
  readonly model = "demo-tts";
  readonly isDemo = true;

  async synthesize(input: { text: string; voiceId?: string }) {
    const startedAt = Date.now();
    const seconds = Math.min(600, Math.max(1, input.text.split(/\s+/).length / 2.5));
    return {
      value: {
        audio: silentWav(seconds),
        mimeType: "audio/wav",
        voiceId: input.voiceId ?? "demo",
      },
      usage: usage(this.name, this.model, startedAt),
    };
  }
}

// --------------------------------------------------------------------------

export class MockOcrProvider implements OcrProvider {
  readonly name = "none";
  readonly available = false;

  async recognize(): Promise<WithUsage<OcrResult>> {
    throw new Error(
      "OCR não configurado. O documento fica com status ocr_required e não " +
        "entra na memória até que um texto utilizável exista.",
    );
  }
}

// --------------------------------------------------------------------------

/**
 * Reranker heurístico — o padrão do MVP, e não um mock no sentido pejorativo.
 * Combina similaridade, autoridade da fonte, especificidade e temporalidade,
 * de forma explicável (cada componente é devolvido em `reasons`).
 */
export class HeuristicRerankingProvider implements RerankingProvider {
  readonly name = "heuristic";
  readonly isDemo = false;

  async rerank(query: string, candidates: RerankCandidate[]): Promise<WithUsage<RerankResult[]>> {
    const startedAt = Date.now();
    const queryTokens = new Set(tokenize(query).map(stem));
    const maxFusion = Math.max(...candidates.map((c) => c.fusionScore), 1e-9);
    const now = Date.now();

    const results = candidates.map((candidate) => {
      const tokens = tokenize(candidate.text).map(stem);
      const unique = new Set(tokens);
      let overlap = 0;
      for (const token of unique) if (queryTokens.has(token)) overlap += 1;

      // pertinência: cobertura dos termos da pergunta
      const pertinence = queryTokens.size ? overlap / queryTokens.size : 0;
      // especificidade: trechos muito curtos ou muito longos perdem valor
      const length = tokens.length;
      const specificity =
        length === 0 ? 0 : Math.min(1, length / 120) * Math.min(1, 400 / Math.max(length, 1));
      // similaridade normalizada vinda da fusão
      const similarity = candidate.fusionScore / maxFusion;
      // autoridade: escala 1..5 → 0..1
      const authority = (Math.min(5, Math.max(1, candidate.authorityLevel)) - 1) / 4;
      // temporalidade: material mais recente recebe um empurrão suave
      const ageDays = candidate.occurredAt
        ? (now - new Date(candidate.occurredAt).getTime()) / 86_400_000
        : 365;
      const recency = 1 / (1 + Math.max(0, ageDays) / 730);

      const reasons = { similarity, pertinence, specificity, authority, recency };
      const score =
        0.4 * similarity +
        0.28 * pertinence +
        0.1 * specificity +
        0.16 * authority +
        0.06 * recency;

      return { id: candidate.id, score, reasons };
    });

    results.sort((a, b) => b.score - a.score);
    return { value: results, usage: { ...usage(this.name, "v1", startedAt), demo: false } };
  }
}
