"use server";

import { revalidatePath } from "next/cache";
import { getAnalystModel, getSpeechToTextProvider } from "@/ai/providers";
import { EPISODE_BUILDER, wrapUntrusted } from "@/ai/prompts";
import { EpisodeSchema } from "@/ai/schemas";
import { recordAudit } from "@/lib/audit";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/supabase/server";
import { sanitizeFilename, truncate } from "@/lib/utils";
import { sha256 } from "@/services/ingestion/text";
import { runInvestigation } from "@/services/investigation";
import { embedTargets } from "@/services/memory/embeddings";
import { runRetrieval } from "@/services/retrieval/engine";
import { writeReflection } from "@/services/reflection/writer";
import { generateNarration, signedAudioUrl } from "@/services/voice/tts";
import { topTerms } from "@/services/library/extractive";

export type ActionResult<T = undefined> =
  ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

// --------------------------------------------------------------------------
// 1. Áudio
// --------------------------------------------------------------------------

export async function prepareAudioUpload(input: {
  filename: string;
  mimeType: string;
  byteSize: number;
  durationSeconds?: number | null;
  kind: "recording" | "upload";
}): Promise<
  ActionResult<{ audioEntryId: string; sessionId: string; bucket: string; path: string }>
> {
  try {
    if (input.byteSize > env().MAX_AUDIO_BYTES) {
      throw new Error(
        `O áudio tem mais que o limite de ${Math.round(env().MAX_AUDIO_BYTES / 1024 / 1024)} MB.`,
      );
    }

    const { supabase, workspaceId, userId } = await requireSession();

    const { data: audio, error } = await supabase
      .from("audio_entries")
      .insert({
        workspace_id: workspaceId,
        kind: input.kind,
        original_filename: sanitizeFilename(input.filename),
        mime_type: input.mimeType,
        byte_size: input.byteSize,
        duration_seconds: input.durationSeconds ?? null,
        status: "uploaded",
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;

    const audioEntryId = audio.id as string;
    const extension = input.mimeType.includes("webm")
      ? "webm"
      : (input.filename.split(".").pop()?.toLowerCase() ?? "audio");
    const path = `${workspaceId}/audio/${audioEntryId}/original.${extension}`;

    await supabase.from("audio_entries").update({ storage_path: path }).eq("id", audioEntryId);

    const { data: session, error: sessionError } = await supabase
      .from("reflection_sessions")
      .insert({
        workspace_id: workspaceId,
        audio_entry_id: audioEntryId,
        status: "awaiting_transcription",
        created_by: userId,
      })
      .select("id")
      .single();
    if (sessionError) throw sessionError;

    return {
      ok: true,
      data: {
        audioEntryId,
        sessionId: session.id as string,
        bucket: "audio-originals",
        path,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/** Sessão a partir de texto digitado — sem áudio, mesmo fluxo editorial. */
export async function createTextSession(
  text: string,
): Promise<ActionResult<{ sessionId: string; transcriptId: string }>> {
  try {
    const content = text.trim();
    if (content.length < 20) throw new Error("Escreva um relato um pouco mais completo.");

    const { supabase, workspaceId, userId } = await requireSession();

    const { data: session, error } = await supabase
      .from("reflection_sessions")
      .insert({
        workspace_id: workspaceId,
        status: "transcript_review",
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: audio, error: audioError } = await supabase
      .from("audio_entries")
      .insert({
        workspace_id: workspaceId,
        kind: "upload",
        title: "Relato escrito",
        status: "transcribed",
        created_by: userId,
      })
      .select("id")
      .single();
    if (audioError) throw audioError;

    const { data: transcript, error: transcriptError } = await supabase
      .from("transcripts")
      .insert({
        workspace_id: workspaceId,
        audio_entry_id: audio.id,
        raw_transcript: content,
        approved_transcript: content,
        provider: "manual",
        model: "digitado",
        status: "under_review",
        created_by: userId,
      })
      .select("id")
      .single();
    if (transcriptError) throw transcriptError;

    await supabase
      .from("reflection_sessions")
      .update({ transcript_id: transcript.id, audio_entry_id: audio.id })
      .eq("id", session.id);

    revalidatePath("/");
    return {
      ok: true,
      data: { sessionId: session.id as string, transcriptId: transcript.id as string },
    };
  } catch (error) {
    return fail(error);
  }
}

// --------------------------------------------------------------------------
// 2. Transcrição
// --------------------------------------------------------------------------

export async function transcribeAudio(
  audioEntryId: string,
): Promise<ActionResult<{ transcriptId: string; text: string; demo: boolean }>> {
  try {
    const { supabase, workspaceId, userId } = await requireSession();

    const { data: audio, error } = await supabase
      .from("audio_entries")
      .select("id, storage_bucket, storage_path, original_filename, mime_type")
      .eq("id", audioEntryId)
      .single();
    if (error) throw error;
    if (!audio.storage_path) throw new Error("Este áudio ainda não foi enviado.");

    await supabase.from("audio_entries").update({ status: "transcribing" }).eq("id", audioEntryId);

    const { data: file, error: downloadError } = await supabase.storage
      .from(audio.storage_bucket as string)
      .download(audio.storage_path as string);
    if (downloadError) throw downloadError;

    const provider = getSpeechToTextProvider();
    const { value, usage } = await provider.transcribe({
      audio: new Uint8Array(await file.arrayBuffer()),
      filename: (audio.original_filename as string) ?? "audio.webm",
      mimeType: (audio.mime_type as string) ?? "audio/webm",
      language: "pt",
    });

    const { data: transcript, error: transcriptError } = await supabase
      .from("transcripts")
      .insert({
        workspace_id: workspaceId,
        audio_entry_id: audioEntryId,
        raw_transcript: value.text,
        approved_transcript: value.text,
        language: value.language,
        provider: provider.name,
        model: provider.model,
        confidence: value.confidence,
        segments: value.segments,
        status: "under_review",
        created_by: userId,
      })
      .select("id")
      .single();
    if (transcriptError) throw transcriptError;

    await supabase.from("audio_entries").update({ status: "transcribed" }).eq("id", audioEntryId);
    await supabase
      .from("reflection_sessions")
      .update({ transcript_id: transcript.id, status: "transcript_review" })
      .eq("audio_entry_id", audioEntryId);

    await recordAudit(supabase, {
      workspaceId,
      actorId: userId,
      actorKind: "ai",
      action: "transcribe",
      entityKind: "transcript",
      entityId: transcript.id as string,
      usage,
    });

    return {
      ok: true,
      data: { transcriptId: transcript.id as string, text: value.text, demo: usage.demo },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function saveTranscript(transcriptId: string, text: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireSession();
    // O bruto nunca é sobrescrito: só `approved_transcript` muda.
    const { error } = await supabase
      .from("transcripts")
      .update({ approved_transcript: text, status: "under_review" })
      .eq("id", transcriptId);
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Aprova a transcrição e cria o episódio na memória episódica. */
export async function approveTranscript(
  transcriptId: string,
  sessionId: string,
): Promise<ActionResult<{ episodeId: string | null }>> {
  try {
    const { supabase, workspaceId, userId } = await requireSession();

    const { data: transcript, error } = await supabase
      .from("transcripts")
      .select("id, approved_transcript, audio_entry_id")
      .eq("id", transcriptId)
      .single();
    if (error) throw error;

    const text = (transcript.approved_transcript as string | null)?.trim();
    if (!text || text.length < 20) {
      throw new Error("A transcrição está vazia ou curta demais para seguir.");
    }

    await supabase
      .from("transcripts")
      .update({ status: "approved", approved_by: userId, approved_at: new Date().toISOString() })
      .eq("id", transcriptId);

    // Memória episódica: só o que foi dito, sem preencher lacunas.
    const model = getAnalystModel();
    const { value: episode, usage } = await model.generateStructured({
      promptName: EPISODE_BUILDER.name,
      promptVersion: EPISODE_BUILDER.version,
      system: EPISODE_BUILDER.system,
      user: wrapUntrusted("Relato transcrito e aprovado", text),
      schema: EpisodeSchema,
      schemaName: EPISODE_BUILDER.schemaName!,
      maxOutputTokens: 1500,
      demoFallback: () => ({
        title: truncate(text.split(/(?<=[.!?])\s+/)[0] ?? text, 70),
        summary: truncate(text, 400),
        occurred_on: null,
        temporality: null,
        themes: topTerms(text, 6),
        entities: [],
        projects: [],
      }),
    });

    const { data: created, error: episodeError } = await supabase
      .from("episodes")
      .insert({
        workspace_id: workspaceId,
        transcript_id: transcriptId,
        audio_entry_id: transcript.audio_entry_id,
        title: episode.title,
        summary: episode.summary,
        narrative: text,
        occurred_on: episode.occurred_on,
        temporality: episode.temporality,
        themes: episode.themes,
        entities: episode.entities,
        projects: episode.projects,
        status: "active",
        created_by: userId,
      })
      .select("id")
      .single();
    if (episodeError) throw episodeError;

    const episodeId = created.id as string;

    await embedTargets(supabase, {
      workspaceId,
      targets: [
        {
          ownerKind: "episode",
          ownerId: episodeId,
          sourceId: null,
          text: `${episode.title}. ${episode.summary} ${text}`.slice(0, 8000),
        },
      ],
    });

    await supabase
      .from("reflection_sessions")
      .update({ episode_id: episodeId, status: "investigating" })
      .eq("id", sessionId);

    await recordAudit(supabase, {
      workspaceId,
      actorId: userId,
      actorKind: "ai",
      action: "build_episode",
      entityKind: "episode",
      entityId: episodeId,
      usage,
    });

    revalidatePath(`/mesa/${sessionId}`);
    return { ok: true, data: { episodeId } };
  } catch (error) {
    return fail(error);
  }
}

// --------------------------------------------------------------------------
// 3. Investigação
// --------------------------------------------------------------------------

export async function investigate(
  sessionId: string,
): Promise<ActionResult<{ dossierId: string; blocking: boolean; evidence: number }>> {
  try {
    const { supabase, workspaceId, userId } = await requireSession();

    const { data: session, error } = await supabase
      .from("reflection_sessions")
      .select("id, transcript_id, transcripts(approved_transcript, status)")
      .eq("id", sessionId)
      .single();
    if (error) throw error;

    const transcript = session.transcripts as unknown as {
      approved_transcript: string | null;
      status: string;
    } | null;

    if (!transcript || transcript.status !== "approved" || !transcript.approved_transcript) {
      throw new Error("Aprove a transcrição antes de investigar a memória.");
    }

    await supabase
      .from("reflection_sessions")
      .update({ status: "investigating" })
      .eq("id", sessionId);

    const retrieval = await runRetrieval(supabase, {
      workspaceId,
      userId,
      inputText: transcript.approved_transcript,
      reflectionSessionId: sessionId,
      transcriptId: session.transcript_id as string,
    });

    const investigation = await runInvestigation(supabase, {
      workspaceId,
      userId,
      reflectionSessionId: sessionId,
      retrieval,
      speechText: transcript.approved_transcript,
    });

    revalidatePath(`/mesa/${sessionId}`);
    return {
      ok: true,
      data: {
        dossierId: investigation.dossierId,
        blocking: investigation.blocking,
        evidence: retrieval.selected.length,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function resolveConflict(input: {
  conflictId: string;
  sessionId: string;
  decision:
    | "keep_speech"
    | "use_memory"
    | "treat_as_complement"
    | "treat_as_evolution"
    | "manual_edit"
    | "ignore_source";
  manualText?: string | null;
  ignoredSourceId?: string | null;
  rationale?: string | null;
}): Promise<ActionResult> {
  try {
    const { supabase, workspaceId, userId } = await requireSession();

    if (input.decision === "manual_edit" && !input.manualText?.trim()) {
      throw new Error("Escreva a redação que deve ser usada.");
    }

    const { error } = await supabase.from("conflict_resolutions").insert({
      workspace_id: workspaceId,
      conflict_id: input.conflictId,
      decision: input.decision,
      manual_text: input.manualText ?? null,
      ignored_source_id: input.ignoredSourceId ?? null,
      rationale: input.rationale ?? null,
      decided_by: userId,
      created_by: userId,
    });
    if (error) throw error;

    await supabase.from("conflicts").update({ status: "resolved" }).eq("id", input.conflictId);

    // Se não sobrou conflito bloqueante, a sessão volta a andar.
    const { data: pending } = await supabase
      .from("conflicts")
      .select("id")
      .eq("reflection_session_id", input.sessionId)
      .eq("blocking", true)
      .eq("status", "open");

    if ((pending ?? []).length === 0) {
      await supabase
        .from("reflection_sessions")
        .update({ status: "dossier_ready", status_reason: null })
        .eq("id", input.sessionId)
        .eq("status", "needs_conflict_review");
    }

    revalidatePath(`/mesa/${input.sessionId}`);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

// --------------------------------------------------------------------------
// 4. Escrita, edição e aprovação
// --------------------------------------------------------------------------

export async function generateReflection(
  sessionId: string,
): Promise<ActionResult<{ versionId: string; versionNumber: number }>> {
  try {
    const { supabase, workspaceId, userId } = await requireSession();
    const result = await writeReflection(supabase, {
      workspaceId,
      userId,
      reflectionSessionId: sessionId,
    });
    revalidatePath(`/mesa/${sessionId}`);
    return {
      ok: true,
      data: { versionId: result.versionId, versionNumber: result.versionNumber },
    };
  } catch (error) {
    return fail(error);
  }
}

/** Editar nunca sobrescreve: cria a próxima versão. */
export async function saveReflectionEdit(input: {
  sessionId: string;
  reflectionId: string;
  parentVersionId: string;
  text: string;
}): Promise<ActionResult<{ versionId: string; versionNumber: number }>> {
  try {
    const text = input.text.trim();
    if (text.length < 20) throw new Error("O texto está curto demais.");

    const { supabase, workspaceId, userId } = await requireSession();

    const { data: parent, error } = await supabase
      .from("reflection_versions")
      .select("id, version_number, text, style_profile_id")
      .eq("id", input.parentVersionId)
      .single();
    if (error) throw error;

    if ((parent.text as string).trim() === text) {
      throw new Error("Nada mudou em relação à versão anterior.");
    }

    const { data: created, error: insertError } = await supabase
      .from("reflection_versions")
      .insert({
        workspace_id: workspaceId,
        reflection_id: input.reflectionId,
        parent_version_id: input.parentVersionId,
        version_number: (parent.version_number as number) + 1,
        text,
        text_hash: sha256(text),
        word_count: text.split(/\s+/).filter(Boolean).length,
        origin: "human_edit",
        style_profile_id: parent.style_profile_id,
        diff_summary: describeDiff(parent.text as string, text),
        status: "edited",
        created_by: userId,
      })
      .select("id, version_number")
      .single();
    if (insertError) throw insertError;

    await supabase
      .from("reflections")
      .update({ current_version_id: created.id })
      .eq("id", input.reflectionId);

    revalidatePath(`/mesa/${input.sessionId}`);
    return {
      ok: true,
      data: { versionId: created.id as string, versionNumber: created.version_number as number },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function approveReflectionVersion(input: {
  sessionId: string;
  reflectionId: string;
  versionId: string;
}): Promise<ActionResult> {
  try {
    const { supabase, workspaceId, userId } = await requireSession();

    const { data: version, error } = await supabase
      .from("reflection_versions")
      .select("id, text, text_hash")
      .eq("id", input.versionId)
      .single();
    if (error) throw error;

    const { error: updateError } = await supabase
      .from("reflection_versions")
      .update({
        status: "approved",
        approved_by: userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", input.versionId);
    if (updateError) throw updateError;

    await supabase
      .from("reflections")
      .update({
        approved_version_id: input.versionId,
        current_version_id: input.versionId,
        status: "approved",
      })
      .eq("id", input.reflectionId);

    await supabase
      .from("reflection_sessions")
      .update({ status: "approved" })
      .eq("id", input.sessionId);

    await recordAudit(supabase, {
      workspaceId,
      actorId: userId,
      actorKind: "user",
      action: "approve_reflection",
      entityKind: "reflection_version",
      entityId: input.versionId,
      metadata: { text_hash: version.text_hash },
    });

    revalidatePath(`/mesa/${input.sessionId}`);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Reflexão aprovada volta para a memória e pode participar de investigações
 * futuras, identificada como `approved_reflection`.
 */
export async function publishReflectionToMemory(input: {
  sessionId: string;
  versionId: string;
  title: string;
}): Promise<ActionResult<{ sourceId: string }>> {
  try {
    const { supabase, workspaceId, userId } = await requireSession();

    const { data: version, error } = await supabase
      .from("reflection_versions")
      .select("id, text, status")
      .eq("id", input.versionId)
      .single();
    if (error) throw error;
    if (version.status !== "approved") {
      throw new Error("Só reflexões aprovadas entram na memória.");
    }

    const { data: source, error: sourceError } = await supabase
      .from("sources")
      .insert({
        workspace_id: workspaceId,
        title: input.title,
        kind: "imported_reflection",
        origin: "approved_reflection",
        // Escala de autoridade: reflexão aprovada é nível 3.
        authority_level: 3,
        status: "ready",
        created_by: userId,
      })
      .select("id")
      .single();
    if (sourceError) throw sourceError;

    const sourceId = source.id as string;
    const text = version.text as string;

    const { data: sourceVersion, error: versionError } = await supabase
      .from("source_versions")
      .insert({
        workspace_id: workspaceId,
        source_id: sourceId,
        version_number: 1,
        storage_path: null,
        raw_text: text,
        normalized_text: text,
        extraction_status: "extracted",
        extraction_engine: "reflection",
        extraction_quality: 1,
        char_count: text.length,
        structure_status: "flat",
        created_by: userId,
      })
      .select("id")
      .single();
    if (versionError) throw versionError;

    const { data: chunk, error: chunkError } = await supabase
      .from("source_chunks")
      .insert({
        workspace_id: workspaceId,
        source_id: sourceId,
        source_version_id: sourceVersion.id,
        sequence: 0,
        text,
        hash: sha256(text),
        token_count: Math.ceil(text.length / 4),
        created_by: userId,
      })
      .select("id")
      .single();
    if (chunkError) throw chunkError;

    await supabase
      .from("sources")
      .update({ current_version_id: sourceVersion.id })
      .eq("id", sourceId);

    await embedTargets(supabase, {
      workspaceId,
      targets: [
        { ownerKind: "chunk", ownerId: chunk.id as string, sourceId, text },
        { ownerKind: "reflection", ownerId: input.versionId, sourceId, text },
      ],
    });

    revalidatePath("/biblioteca");
    revalidatePath(`/mesa/${input.sessionId}`);
    return { ok: true, data: { sourceId } };
  } catch (error) {
    return fail(error);
  }
}

// --------------------------------------------------------------------------
// 5. Voz
// --------------------------------------------------------------------------

export async function generateVoice(input: {
  sessionId: string;
  versionId: string;
}): Promise<ActionResult<{ url: string | null; demo: boolean }>> {
  try {
    const { supabase, workspaceId, userId } = await requireSession();
    const narration = await generateNarration(supabase, {
      workspaceId,
      userId,
      reflectionVersionId: input.versionId,
    });

    const url = await signedAudioUrl(supabase, {
      bucket: "audio-generated",
      path: narration.storagePath,
    });

    revalidatePath(`/mesa/${input.sessionId}`);
    return { ok: true, data: { url, demo: narration.demo } };
  } catch (error) {
    return fail(error);
  }
}

export async function getSignedUrl(input: {
  bucket: string;
  path: string;
  download?: string;
}): Promise<ActionResult<{ url: string }>> {
  try {
    const { supabase } = await requireSession();
    const url = await signedAudioUrl(supabase, input);
    if (!url) throw new Error("Não foi possível gerar o link temporário.");
    return { ok: true, data: { url } };
  } catch (error) {
    return fail(error);
  }
}

// --------------------------------------------------------------------------

function describeDiff(before: string, after: string): string {
  const wordsBefore = before.split(/\s+/).filter(Boolean).length;
  const wordsAfter = after.split(/\s+/).filter(Boolean).length;
  const delta = wordsAfter - wordsBefore;
  const direction = delta > 0 ? `+${delta}` : String(delta);
  return `Edição humana: ${wordsBefore} → ${wordsAfter} palavras (${direction}).`;
}
