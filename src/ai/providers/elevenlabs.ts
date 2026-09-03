import type { ProviderUsage, TextToSpeechProvider, WithUsage } from "./types";

const API_BASE = "https://api.elevenlabs.io/v1";

/**
 * Text-to-Speech pela ElevenLabs, usando `fetch` direto para não acoplar o
 * projeto a mais um SDK. Trocar de fornecedor significa escrever outra classe
 * que implemente `TextToSpeechProvider` — nada além disso muda.
 */
export class ElevenLabsTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = "elevenlabs";
  readonly isDemo = false;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly defaultVoiceId: string,
  ) {}

  async synthesize(input: { text: string; voiceId?: string }): Promise<
    WithUsage<{ audio: Uint8Array; mimeType: string; voiceId: string }>
  > {
    const startedAt = Date.now();
    const voiceId = input.voiceId?.trim() || this.defaultVoiceId;

    const response = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: input.text,
        model_id: this.model,
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.15 },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `ElevenLabs respondeu ${response.status}. ${detail.slice(0, 400)}`.trim(),
      );
    }

    const audio = new Uint8Array(await response.arrayBuffer());
    const usage: ProviderUsage = {
      provider: this.name,
      model: this.model,
      latencyMs: Date.now() - startedAt,
      tokensIn: input.text.length,
      demo: false,
    };

    return { value: { audio, mimeType: "audio/mpeg", voiceId }, usage };
  }
}
