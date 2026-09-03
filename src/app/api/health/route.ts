import { NextResponse } from "next/server";
import { aiCapabilities } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Verificação de fumaça: a aplicação subiu e sabe quais capacidades tem. */
export async function GET() {
  try {
    const capabilities = aiCapabilities();
    return NextResponse.json({
      ok: true,
      app: "memoria-reflexiva",
      time: new Date().toISOString(),
      capabilities: {
        llm: capabilities.llm,
        embedding: capabilities.embedding,
        transcription: capabilities.transcription,
        tts: capabilities.tts,
        demoMode: capabilities.demoMode,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "erro desconhecido" },
      { status: 500 },
    );
  }
}
