import { z } from "zod";

/**
 * Configuração central da aplicação.
 *
 * Regra de ouro do projeto: nada de chave de IA obrigatória para o sistema
 * subir. Se uma chave não estiver configurada, o provider correspondente cai
 * para o modo demonstração (mock determinístico) e a interface avisa.
 */

const intFromEnv = (fallback: number) =>
  z.coerce.number().int().positive().catch(fallback);

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),

  LLM_PROVIDER: z.enum(["openai", "mock"]).catch("openai"),
  EMBEDDING_PROVIDER: z.enum(["openai", "mock"]).catch("openai"),
  TRANSCRIPTION_PROVIDER: z.enum(["openai", "mock"]).catch("openai"),
  TTS_PROVIDER: z.enum(["elevenlabs", "openai", "mock"]).catch("elevenlabs"),
  RERANKING_PROVIDER: z.enum(["heuristic", "llm", "mock"]).catch("heuristic"),
  OCR_PROVIDER: z.enum(["none", "mock"]).catch("none"),

  ANALYSIS_MODEL: z.string().catch("gpt-5-mini"),
  WRITER_MODEL: z.string().catch("gpt-5"),
  TRANSCRIPTION_MODEL: z.string().catch("whisper-1"),
  EMBEDDING_MODEL: z.string().catch("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: intFromEnv(1536),

  TTS_API_KEY: z.string().optional(),
  TTS_VOICE_ID: z.string().catch("JBFqnCBsd6RMkjVDRZzb"),
  TTS_MODEL: z.string().catch("eleven_multilingual_v2"),

  MAX_DOCUMENT_BYTES: intFromEnv(52_428_800),
  MAX_AUDIO_BYTES: intFromEnv(104_857_600),
  CHUNK_TARGET_TOKENS: intFromEnv(450),
  CHUNK_OVERLAP_TOKENS: intFromEnv(60),

  NEXT_PUBLIC_APP_NAME: z.string().catch("Memória Reflexiva"),
  NEXT_PUBLIC_SITE_URL: z.string().catch("http://localhost:3000"),
  JOB_RUNNER_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Configuração inválida em .env.local:\n${issues}\n\n` +
        `Copie .env.example para .env.local e preencha as variáveis do Supabase.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Capacidades de IA realmente disponíveis com as chaves atuais. */
export function aiCapabilities() {
  const e = env();
  const hasOpenAI = Boolean(e.OPENAI_API_KEY?.trim());
  const hasTts = Boolean(e.TTS_API_KEY?.trim()) || (e.TTS_PROVIDER === "openai" && hasOpenAI);
  return {
    llm: e.LLM_PROVIDER === "openai" && hasOpenAI,
    embedding: e.EMBEDDING_PROVIDER === "openai" && hasOpenAI,
    transcription: e.TRANSCRIPTION_PROVIDER === "openai" && hasOpenAI,
    tts: e.TTS_PROVIDER !== "mock" && hasTts,
    /** true quando algum provider está rodando em mock */
    get demoMode() {
      return !(this.llm && this.embedding && this.transcription && this.tts);
    },
  };
}
