import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireSession } from "@/lib/supabase/server";
import { ReviewDesk, type DeskData } from "@/features/reflections/review-desk";
import { signedAudioUrl } from "@/services/voice/tts";

export const metadata: Metadata = { title: "Mesa de revisão" };
export const dynamic = "force-dynamic";

export default async function MesaSessaoPage(props: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await props.params;
  const { supabase, workspaceId } = await requireSession();

  type SessionRow = {
    id: string;
    status: string;
    status_reason: string | null;
    central_question: string | null;
    intent: string | null;
    created_at: string;
    audio_entry_id: string | null;
    transcript_id: string | null;
    dossier_id: string | null;
    retrieval_session_id: string | null;
    episode_id: string | null;
  };

  const { data: sessionRow } = await supabase
    .from("reflection_sessions")
    .select(
      "id, status, status_reason, central_question, intent, created_at, " +
        "audio_entry_id, transcript_id, dossier_id, retrieval_session_id, episode_id",
    )
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!sessionRow) notFound();
  const session = sessionRow as unknown as SessionRow;

  const [audioResult, transcriptResult, dossierResult, conflictsResult, reflectionResult] =
    await Promise.all([
      session.audio_entry_id
        ? supabase
            .from("audio_entries")
            .select("id, storage_bucket, storage_path, duration_seconds, original_filename, kind")
            .eq("id", session.audio_entry_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      session.transcript_id
        ? supabase
            .from("transcripts")
            .select("id, raw_transcript, approved_transcript, status, provider, model, confidence")
            .eq("id", session.transcript_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      session.dossier_id
        ? supabase.from("memory_dossiers").select("*").eq("id", session.dossier_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("conflicts")
        .select(
          "id, kind, severity, blocking, title, description, speech_excerpt, memory_excerpt, " +
            "status, confidence, conflict_resolutions(decision, manual_text, rationale, decided_at)",
        )
        .eq("reflection_session_id", sessionId)
        .order("severity", { ascending: false }),
      supabase
        .from("reflections")
        .select(
          "id, title, status, current_version_id, approved_version_id, " +
            "reflection_versions(id, version_number, text, status, origin, model, " +
            "word_count, diff_summary, created_at, approved_at)",
        )
        .eq("session_id", sessionId)
        .maybeSingle(),
    ]);

  // Evidências selecionadas na investigação.
  const evidenceResult = session.retrieval_session_id
    ? await supabase
        .from("retrieval_hits")
        .select(
          "id, owner_kind, owner_id, source_id, snippet, authority_level, final_score, " +
            "fusion_score, rerank_score, vector_score, fulltext_score, explanation, " +
            "sources(title, authors), source_sections(title)",
        )
        .eq("retrieval_session_id", session.retrieval_session_id)
        .eq("selected", true)
        .order("final_score", { ascending: false })
    : { data: null };

  const audio = audioResult.data as {
    id: string;
    storage_bucket: string;
    storage_path: string | null;
    duration_seconds: number | null;
    original_filename: string | null;
    kind: string;
  } | null;

  const audioUrl = audio?.storage_path
    ? await signedAudioUrl(supabase, {
        bucket: audio.storage_bucket,
        path: audio.storage_path,
        expiresIn: 3600,
      })
    : null;

  const reflection = reflectionResult.data as {
    id: string;
    title: string | null;
    status: string;
    current_version_id: string | null;
    approved_version_id: string | null;
    reflection_versions: DeskData["versions"];
  } | null;

  // Áudio narrado da versão aprovada.
  let narrationUrl: string | null = null;
  let narrationStatus: string | null = null;
  if (reflection?.approved_version_id) {
    const { data: narration } = await supabase
      .from("reflection_audio_versions")
      .select("id, storage_bucket, storage_path, status, duration_seconds, provider")
      .eq("reflection_version_id", reflection.approved_version_id)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (narration?.storage_path) {
      narrationStatus = narration.status as string;
      narrationUrl = await signedAudioUrl(supabase, {
        bucket: narration.storage_bucket as string,
        path: narration.storage_path as string,
        expiresIn: 3600,
      });
    }
  }

  const data: DeskData = {
    session: {
      id: session.id,
      status: session.status,
      statusReason: session.status_reason,
      centralQuestion: session.central_question,
      createdAt: session.created_at,
      hasRetrieval: Boolean(session.retrieval_session_id),
    },
    audio: audio
      ? {
          id: audio.id,
          url: audioUrl,
          durationSeconds: audio.duration_seconds,
          filename: audio.original_filename,
          kind: audio.kind,
        }
      : null,
    transcript: transcriptResult.data
      ? {
          id: transcriptResult.data.id as string,
          raw: (transcriptResult.data.raw_transcript as string | null) ?? "",
          approved: (transcriptResult.data.approved_transcript as string | null) ?? "",
          status: transcriptResult.data.status as string,
          provider: (transcriptResult.data.provider as string | null) ?? null,
          confidence: (transcriptResult.data.confidence as number | null) ?? null,
        }
      : null,
    dossier: (dossierResult.data as DeskData["dossier"]) ?? null,
    evidence: ((evidenceResult.data ?? []) as unknown as DeskData["evidence"]) ?? [],
    conflicts: ((conflictsResult.data ?? []) as unknown as DeskData["conflicts"]) ?? [],
    reflection: reflection
      ? {
          id: reflection.id,
          title: reflection.title,
          status: reflection.status,
          currentVersionId: reflection.current_version_id,
          approvedVersionId: reflection.approved_version_id,
        }
      : null,
    versions: (reflection?.reflection_versions ?? []).sort(
      (a, b) => b.version_number - a.version_number,
    ),
    narration: { url: narrationUrl, status: narrationStatus },
  };

  return <ReviewDesk data={data} />;
}
