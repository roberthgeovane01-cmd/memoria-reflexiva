import OpenAI from "openai";
import type {
  EmbeddingProvider,
  LanguageModelProvider,
  ProviderUsage,
  SpeechToTextProvider,
  StructuredRequest,
  TextRequest,
  TextToSpeechProvider,
  WithUsage,
} from "./types";
import { toStrictJsonSchema } from "./json-schema";

/** Modelos de raciocínio não aceitam `temperature`. */
function supportsTemperature(model: string): boolean {
  return !isReasoningModel(model);
}

function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[1-9])/.test(model);
}

type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * Em modelos de raciocínio, `max_output_tokens` cobre TAMBÉM os tokens de
 * raciocínio, que nunca aparecem na resposta. Um orçamento apertado faz o
 * modelo gastar tudo pensando e devolver texto vazio, sem erro do fornecedor —
 * foi exatamente o que aconteceu com o `episode_builder` sobre uma transcrição
 * de sete minutos. Reservamos espaço para o raciocínio além do que a chamada
 * pediu para escrever.
 */
const RESERVA_DE_RACIOCINIO = 6000;

function outputBudget(
  model: string,
  requested: number | undefined,
  factor = 1,
): number | undefined {
  if (!requested) return undefined;
  if (!isReasoningModel(model)) return requested;
  return requested + RESERVA_DE_RACIOCINIO * factor;
}

function reasoningOption(model: string, effort: ReasoningEffort) {
  return isReasoningModel(model) ? { reasoning: { effort } } : {};
}

/** A resposta ficou incompleta porque o orçamento acabou antes da escrita. */
function ranOutOfBudget(response: {
  status?: string | null;
  incomplete_details?: unknown;
}): boolean {
  if (response.status !== "incomplete") return false;
  const reason = (response.incomplete_details as { reason?: string } | null | undefined)?.reason;
  return reason === "max_output_tokens" || reason === undefined;
}

function emptyResponseError(
  model: string,
  promptName: string,
  response: { status?: string | null; incomplete_details?: unknown },
): Error {
  const reason = (response.incomplete_details as { reason?: string } | null | undefined)?.reason;
  if (response.status === "incomplete") {
    return new Error(
      `O modelo ${model} não conseguiu concluir ${promptName}: a resposta foi ` +
        `interrompida (${reason ?? "motivo não informado"}). Tente de novo com um ` +
        `relato mais curto ou avise para aumentar o orçamento de tokens.`,
    );
  }
  return new Error(`Resposta vazia do modelo ${model} (${promptName}).`);
}

function makeUsage(
  model: string,
  startedAt: number,
  tokens?: { input_tokens?: number; output_tokens?: number },
): ProviderUsage {
  return {
    provider: "openai",
    model,
    latencyMs: Date.now() - startedAt,
    tokensIn: tokens?.input_tokens,
    tokensOut: tokens?.output_tokens,
    demo: false,
  };
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly isDemo = false;
  private client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    readonly dimensions: number,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<WithUsage<number[][]>> {
    const startedAt = Date.now();
    if (texts.length === 0) {
      return { value: [], usage: makeUsage(this.model, startedAt) };
    }

    // A API tem limite por requisição; enviamos em lotes previsíveis.
    const batchSize = 96;
    const vectors: number[][] = [];
    let tokensIn = 0;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, 30_000));
      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
        dimensions: this.dimensions,
      });
      tokensIn += response.usage?.prompt_tokens ?? 0;
      for (const item of response.data) vectors.push(item.embedding as number[]);
    }

    return {
      value: vectors,
      usage: { ...makeUsage(this.model, startedAt), tokensIn },
    };
  }
}

export class OpenAILanguageModelProvider implements LanguageModelProvider {
  readonly name = "openai";
  readonly isDemo = false;
  private client: OpenAI;

  constructor(
    apiKey: string,
    private readonly defaultModel: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<WithUsage<T>> {
    const startedAt = Date.now();
    const model = request.model ?? this.defaultModel;

    const format = {
      type: "json_schema" as const,
      ...(toStrictJsonSchema(request.schema, request.schemaName) as {
        name: string;
        schema: Record<string, unknown>;
        strict: boolean;
      }),
    };

    const call = async (factor: number, effort: ReasoningEffort) => {
      const budget = outputBudget(model, request.maxOutputTokens, factor);
      return this.client.responses.create({
        model,
        instructions: request.system,
        input: request.user,
        ...(supportsTemperature(model) && request.temperature !== undefined
          ? { temperature: request.temperature }
          : {}),
        ...(budget ? { max_output_tokens: budget } : {}),
        ...reasoningOption(model, effort),
        text: { format },
      });
    };

    let response = await call(1, "low");

    // Segunda e última tentativa: mais orçamento e o mínimo de raciocínio.
    // Sem isto, uma entrada longa devolve texto vazio silenciosamente.
    if (!response.output_text && ranOutOfBudget(response) && isReasoningModel(model)) {
      response = await call(3, "minimal");
    }

    const raw = response.output_text;
    if (!raw) throw emptyResponseError(model, request.promptName, response);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw new Error(
        `O modelo ${model} devolveu JSON inválido em ${request.promptName}. ` +
          `Início da resposta: ${raw.slice(0, 200)}`,
      );
    }

    // Validação final é sempre nossa: nunca confiamos no fornecedor.
    const value = request.schema.parse(parsedJson);
    return { value, usage: makeUsage(model, startedAt, response.usage) };
  }

  async generateText(request: TextRequest): Promise<WithUsage<string>> {
    const startedAt = Date.now();
    const model = request.model ?? this.defaultModel;

    const call = async (factor: number, effort: ReasoningEffort) => {
      const budget = outputBudget(model, request.maxOutputTokens, factor);
      return this.client.responses.create({
        model,
        instructions: request.system,
        input: request.user,
        ...(supportsTemperature(model) && request.temperature !== undefined
          ? { temperature: request.temperature }
          : {}),
        ...(budget ? { max_output_tokens: budget } : {}),
        ...reasoningOption(model, effort),
      });
    };

    let response = await call(1, "low");
    if (!response.output_text?.trim() && ranOutOfBudget(response) && isReasoningModel(model)) {
      response = await call(3, "minimal");
    }

    const text = response.output_text?.trim();
    if (!text) throw emptyResponseError(model, request.promptName, response);
    return { value: text, usage: makeUsage(model, startedAt, response.usage) };
  }
}

export class OpenAISpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "openai";
  readonly isDemo = false;
  private client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(input: {
    audio: Blob | Buffer | Uint8Array;
    filename: string;
    mimeType: string;
    language?: string;
  }) {
    const startedAt = Date.now();
    const blob =
      input.audio instanceof Blob
        ? input.audio
        : new Blob([new Uint8Array(input.audio as Uint8Array)], { type: input.mimeType });
    const file = new File([blob], input.filename, { type: input.mimeType });

    const response = (await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      language: (input.language ?? "pt").slice(0, 2),
      response_format: "verbose_json",
    })) as unknown as {
      text: string;
      language?: string;
      segments?: Array<{ start: number; end: number; text: string; no_speech_prob?: number }>;
    };

    const segments = (response.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }));
    const confidence = response.segments?.length
      ? 1 -
        response.segments.reduce((acc, s) => acc + (s.no_speech_prob ?? 0), 0) /
          response.segments.length
      : null;

    return {
      value: {
        text: response.text.trim(),
        language: response.language ?? input.language ?? "pt-BR",
        confidence,
        segments,
      },
      usage: makeUsage(this.model, startedAt),
    };
  }
}

export class OpenAITextToSpeechProvider implements TextToSpeechProvider {
  readonly name = "openai";
  readonly isDemo = false;
  private client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly defaultVoice: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async synthesize(input: { text: string; voiceId?: string }) {
    const startedAt = Date.now();
    const voice = input.voiceId ?? this.defaultVoice;
    const response = await this.client.audio.speech.create({
      model: this.model,
      voice: voice as never,
      input: input.text,
      response_format: "mp3",
    });
    const buffer = new Uint8Array(await response.arrayBuffer());
    return {
      value: { audio: buffer, mimeType: "audio/mpeg", voiceId: voice },
      usage: makeUsage(this.model, startedAt),
    };
  }
}
