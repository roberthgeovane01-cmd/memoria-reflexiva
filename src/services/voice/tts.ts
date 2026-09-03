import type { SupabaseClient } from "@supabase/supabase-js";
import { getTextToSpeechProvider } from "@/ai/providers";
import { recordAudit } from "@/lib/audit";

export type NarrationResult = {
  audioVersionId: string;
  storagePath: string;
  mimeType: string;
  byteSize: number;
  demo: boolean;
};

/**
 * VOZ — só depois da aprovação.
 *
 * A regra é aplicada em três camadas: aqui, no trigger do banco
 * (`enforce_tts_requires_approval`) e na comparação do hash do texto. Nem uma
 * versão em rascunho, nem um texto alterado depois da aprovação, geram áudio.
 */
export async function generateNarration(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string | null;
    reflectionVersionId: string;
    voiceProfileId?: string | null;
  },
): Promise<NarrationResult> {
  const { data: version, error } = await supabase
    .from("reflection_versions")
    .select("id, text, text_hash, status, reflection_id")
    .eq("id", input.reflectionVersionId)
    .single();
  if (error) throw error;

  if (version.status !== "approved") {
    throw new Error("A voz só é gerada para uma versão aprovada. Aprove o texto antes de narrar.");
  }

  // Perfil de voz: o pedido, ou o padrão do workspace.
  const voiceQuery = supabase
    .from("voice_profiles")
    .select("id, provider, voice_id, model, is_cloned, consent_status")
    .eq("workspace_id", input.workspaceId)
    .eq("status", "active");

  const { data: voice } = input.voiceProfileId
    ? await voiceQuery.eq("id", input.voiceProfileId).maybeSingle()
    : await voiceQuery.eq("is_default", true).maybeSingle();

  if (voice?.is_cloned && voice.consent_status !== "granted") {
    throw new Error(
      "Esta voz é personalizada e não tem consentimento registrado. " +
        "Voz de terceiros nunca é clonada sem autorização explícita.",
    );
  }

  const provider = getTextToSpeechProvider();

  // A linha nasce antes da síntese: se o trigger recusar, nem gastamos a chamada.
  const { data: audioVersion, error: insertError } = await supabase
    .from("reflection_audio_versions")
    .insert({
      workspace_id: input.workspaceId,
      reflection_version_id: input.reflectionVersionId,
      voice_profile_id: voice?.id ?? null,
      text_hash: version.text_hash,
      provider: provider.name,
      model: provider.model,
      voice_id: (voice?.voice_id as string | null) ?? null,
      status: "generating",
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const audioVersionId = audioVersion.id as string;

  try {
    const { value, usage } = await provider.synthesize({
      text: version.text as string,
      voiceId: (voice?.voice_id as string | null) ?? undefined,
    });

    const extension = value.mimeType === "audio/wav" ? "wav" : "mp3";
    const storagePath = `${input.workspaceId}/reflections/${input.reflectionVersionId}/${audioVersionId}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("audio-generated")
      .upload(storagePath, value.audio, { contentType: value.mimeType, upsert: true });
    if (uploadError) throw uploadError;

    await supabase
      .from("reflection_audio_versions")
      .update({
        storage_path: storagePath,
        mime_type: value.mimeType,
        byte_size: value.audio.byteLength,
        voice_id: value.voiceId,
        status: "ready",
      })
      .eq("id", audioVersionId);

    await recordAudit(supabase, {
      workspaceId: input.workspaceId,
      actorId: input.userId,
      actorKind: "ai",
      action: "tts",
      entityKind: "reflection_audio_version",
      entityId: audioVersionId,
      usage,
    });

    return {
      audioVersionId,
      storagePath,
      mimeType: value.mimeType,
      byteSize: value.audio.byteLength,
      demo: usage.demo,
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    await supabase
      .from("reflection_audio_versions")
      .update({ status: "failed", error_message: message.slice(0, 1000) })
      .eq("id", audioVersionId);
    throw caught;
  }
}

/** URL temporária e assinada — os buckets nunca são públicos. */
export async function signedAudioUrl(
  supabase: SupabaseClient,
  input: { bucket: string; path: string; expiresIn?: number; download?: string },
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(input.bucket)
    .createSignedUrl(
      input.path,
      input.expiresIn ?? 3600,
      input.download ? { download: input.download } : undefined,
    );
  if (error) return null;
  return data.signedUrl;
}
