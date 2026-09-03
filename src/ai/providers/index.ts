import { env } from "@/lib/env";
import {
  HeuristicRerankingProvider,
  MockEmbeddingProvider,
  MockLanguageModelProvider,
  MockOcrProvider,
  MockSpeechToTextProvider,
  MockTextToSpeechProvider,
} from "./mock";
import {
  OpenAIEmbeddingProvider,
  OpenAILanguageModelProvider,
  OpenAISpeechToTextProvider,
  OpenAITextToSpeechProvider,
} from "./openai";
import { ElevenLabsTextToSpeechProvider } from "./elevenlabs";
import type {
  EmbeddingProvider,
  LanguageModelProvider,
  OcrProvider,
  RerankingProvider,
  SpeechToTextProvider,
  TextToSpeechProvider,
} from "./types";

export * from "./types";

/**
 * Fábrica de providers.
 *
 * A regra: se a chave existe, usa o fornecedor real; se não existe, cai para o
 * modo demonstração — sem quebrar o fluxo e sem fingir que a IA respondeu.
 */

let embedding: EmbeddingProvider | null = null;
let analyst: LanguageModelProvider | null = null;
let writer: LanguageModelProvider | null = null;
let stt: SpeechToTextProvider | null = null;
let tts: TextToSpeechProvider | null = null;
let reranker: RerankingProvider | null = null;
let ocr: OcrProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (embedding) return embedding;
  const e = env();
  const key = e.OPENAI_API_KEY?.trim();
  embedding =
    e.EMBEDDING_PROVIDER === "openai" && key
      ? new OpenAIEmbeddingProvider(key, e.EMBEDDING_MODEL, e.EMBEDDING_DIMENSIONS)
      : new MockEmbeddingProvider("deterministic-hash-1536", e.EMBEDDING_DIMENSIONS);
  return embedding;
}

/** Modelo analista: planner, classificadores, conflitos e dossiê. */
export function getAnalystModel(): LanguageModelProvider {
  if (analyst) return analyst;
  const e = env();
  const key = e.OPENAI_API_KEY?.trim();
  analyst =
    e.LLM_PROVIDER === "openai" && key
      ? new OpenAILanguageModelProvider(key, e.ANALYSIS_MODEL)
      : new MockLanguageModelProvider();
  return analyst;
}

/** Modelo escritor: só a redação final da reflexão. */
export function getWriterModel(): LanguageModelProvider {
  if (writer) return writer;
  const e = env();
  const key = e.OPENAI_API_KEY?.trim();
  writer =
    e.LLM_PROVIDER === "openai" && key
      ? new OpenAILanguageModelProvider(key, e.WRITER_MODEL)
      : new MockLanguageModelProvider();
  return writer;
}

export function getSpeechToTextProvider(): SpeechToTextProvider {
  if (stt) return stt;
  const e = env();
  const key = e.OPENAI_API_KEY?.trim();
  stt =
    e.TRANSCRIPTION_PROVIDER === "openai" && key
      ? new OpenAISpeechToTextProvider(key, e.TRANSCRIPTION_MODEL)
      : new MockSpeechToTextProvider();
  return stt;
}

export function getTextToSpeechProvider(): TextToSpeechProvider {
  if (tts) return tts;
  const e = env();
  const ttsKey = e.TTS_API_KEY?.trim();
  const openaiKey = e.OPENAI_API_KEY?.trim();

  if (e.TTS_PROVIDER === "elevenlabs" && ttsKey) {
    tts = new ElevenLabsTextToSpeechProvider(ttsKey, e.TTS_MODEL, e.TTS_VOICE_ID);
  } else if (e.TTS_PROVIDER === "openai" && openaiKey) {
    tts = new OpenAITextToSpeechProvider(openaiKey, "gpt-4o-mini-tts", "alloy");
  } else {
    tts = new MockTextToSpeechProvider();
  }
  return tts;
}

export function getRerankingProvider(): RerankingProvider {
  if (reranker) return reranker;
  reranker = new HeuristicRerankingProvider();
  return reranker;
}

export function getOcrProvider(): OcrProvider {
  if (ocr) return ocr;
  ocr = new MockOcrProvider();
  return ocr;
}

/** Usado nos testes para trocar implementações. */
export function __resetProviders() {
  embedding = analyst = writer = null;
  stt = tts = reranker = ocr = null;
}
