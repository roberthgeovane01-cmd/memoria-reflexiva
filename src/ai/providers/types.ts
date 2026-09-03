import type { z } from "zod";

/**
 * Contratos dos provedores de IA.
 *
 * Nenhuma parte do sistema fala com a OpenAI, a ElevenLabs ou qualquer outro
 * fornecedor diretamente. Tudo passa por estas interfaces, para que trocar de
 * fornecedor seja uma questão de configuração, não de reescrita.
 */

export type ProviderUsage = {
  provider: string;
  model: string;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  estimatedCost?: number;
  demo: boolean;
};

export type WithUsage<T> = { value: T; usage: ProviderUsage };

// --------------------------------------------------------------------------

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  readonly isDemo: boolean;
  embed(texts: string[]): Promise<WithUsage<number[][]>>;
}

// --------------------------------------------------------------------------

export type StructuredRequest<T> = {
  /** Nome do prompt versionado, para registro em prompt_versions. */
  promptName: string;
  promptVersion: number;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Nome do schema enviado ao fornecedor (structured outputs). */
  schemaName: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Resposta usada no modo demonstração, quando não há chave de IA. */
  demoFallback: () => T;
};

export type TextRequest = {
  promptName: string;
  promptVersion: number;
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  demoFallback: () => string;
};

export interface LanguageModelProvider {
  readonly name: string;
  readonly isDemo: boolean;
  generateStructured<T>(request: StructuredRequest<T>): Promise<WithUsage<T>>;
  generateText(request: TextRequest): Promise<WithUsage<string>>;
}

// --------------------------------------------------------------------------

export type TranscriptionResult = {
  text: string;
  language: string;
  confidence: number | null;
  segments: Array<{ start: number; end: number; text: string }>;
};

export interface SpeechToTextProvider {
  readonly name: string;
  readonly model: string;
  readonly isDemo: boolean;
  transcribe(input: {
    audio: Blob | Buffer | Uint8Array;
    filename: string;
    mimeType: string;
    language?: string;
  }): Promise<WithUsage<TranscriptionResult>>;
}

// --------------------------------------------------------------------------

export type SynthesisResult = {
  audio: Uint8Array;
  mimeType: string;
  voiceId: string;
};

export interface TextToSpeechProvider {
  readonly name: string;
  readonly model: string;
  readonly isDemo: boolean;
  synthesize(input: { text: string; voiceId?: string }): Promise<WithUsage<SynthesisResult>>;
}

// --------------------------------------------------------------------------

export type RerankCandidate = {
  id: string;
  text: string;
  /** Score vindo da fusão RRF. */
  fusionScore: number;
  authorityLevel: number;
  sourceId: string | null;
  /** Data de validade/criação, para o critério de temporalidade. */
  occurredAt?: string | null;
};

export type RerankResult = {
  id: string;
  score: number;
  reasons: Record<string, number>;
};

export interface RerankingProvider {
  readonly name: string;
  readonly isDemo: boolean;
  rerank(query: string, candidates: RerankCandidate[]): Promise<WithUsage<RerankResult[]>>;
}

// --------------------------------------------------------------------------

export type OcrResult = {
  text: string;
  confidence: number;
  pageCount: number;
};

export interface OcrProvider {
  readonly name: string;
  readonly available: boolean;
  recognize(input: { file: Uint8Array; mimeType: string }): Promise<WithUsage<OcrResult>>;
}
