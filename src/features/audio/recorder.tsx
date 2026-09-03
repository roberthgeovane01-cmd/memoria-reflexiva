"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Pause, Play, Square, Trash2, Upload } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Muted,
  Progress,
} from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { formatBytes, formatDuration } from "@/lib/utils";
import { prepareAudioUpload, transcribeAudio } from "@/features/reflections/actions";

type Status = "idle" | "recording" | "paused" | "ready" | "sending" | "error";

function isRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined"
  );
}

function recordingFilename(): string {
  return `gravacao-${Date.now()}.webm`;
}

/**
 * Gravador de áudio no navegador.
 *
 * Iniciar, pausar, continuar, cancelar, finalizar — e o arquivo original é
 * sempre preservado no Storage privado, nunca substituído pela transcrição.
 */
export function AudioRecorder({ initialMode }: { initialMode: "gravar" | "upload" }) {
  const router = useRouter();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [mode, setMode] = useState<"gravar" | "upload">(initialMode);
  const [status, setStatus] = useState<Status>("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    stopTimer();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, [stopTimer]);

  useEffect(() => () => cleanup(), [cleanup]);

  async function startRecording() {
    setError(null);
    if (!isRecordingSupported()) {
      setStatus("error");
      setError(
        'Este navegador não permite gravar áudio. Use a aba "Enviar arquivo" ou escreva o relato.',
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const recorded = new Blob(chunksRef.current, { type: "audio/webm" });
        setBlob(recorded);
        setPreviewUrl(URL.createObjectURL(recorded));
        setStatus("ready");
        cleanup();
      };

      recorder.start(1000);
      recorderRef.current = recorder;
      setSeconds(0);
      setStatus("recording");
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setStatus("error");
      setError(
        "Não consegui acessar o microfone. Verifique a permissão do navegador e tente de novo.",
      );
    }
  }

  function pauseRecording() {
    recorderRef.current?.pause();
    stopTimer();
    setStatus("paused");
  }

  function resumeRecording() {
    recorderRef.current?.resume();
    setStatus("recording");
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  function finishRecording() {
    recorderRef.current?.stop();
    stopTimer();
  }

  function cancelRecording() {
    recorderRef.current?.stop();
    cleanup();
    setBlob(null);
    setPreviewUrl(null);
    setSeconds(0);
    setStatus("idle");
  }

  async function send() {
    if (!blob) return;
    setStatus("sending");
    setError(null);

    try {
      setStep("Salvando o áudio original…");
      setProgress(20);

      const filename = mode === "gravar" ? recordingFilename() : (fileName ?? "audio");
      const prepared = await prepareAudioUpload({
        filename,
        mimeType: blob.type || "audio/webm",
        byteSize: blob.size,
        durationSeconds: seconds || null,
        kind: mode === "gravar" ? "recording" : "upload",
      });

      if (!prepared.ok) {
        setStatus("error");
        setError(prepared.error);
        return;
      }

      const supabase = getBrowserSupabase();
      const { error: uploadError } = await supabase.storage
        .from(prepared.data.bucket)
        .upload(prepared.data.path, blob, {
          contentType: blob.type || "audio/webm",
          upsert: true,
        });
      if (uploadError) throw new Error(uploadError.message);

      setStep("Transcrevendo…");
      setProgress(65);

      const transcription = await transcribeAudio(prepared.data.audioEntryId);
      if (!transcription.ok) {
        setStatus("error");
        setError(
          `O áudio foi salvo, mas a transcrição falhou: ${transcription.error}. ` +
            `Você pode abrir a sessão e escrever a transcrição manualmente.`,
        );
        return;
      }

      setProgress(100);
      setStep("Pronto. Abrindo a mesa de revisão…");
      router.push(`/mesa/${prepared.data.sessionId}`);
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Erro inesperado.");
    }
  }

  const [fileName, setFileName] = useState<string | null>(null);

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBlob(file);
    setFileName(file.name);
    setPreviewUrl(URL.createObjectURL(file));
    setSeconds(0);
    setStatus("ready");
  }

  const sending = status === "sending";

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>Seu relato</CardTitle>
        <div className="bg-surface-2 flex gap-1 rounded-[var(--radius)] p-1">
          <button
            type="button"
            onClick={() => setMode("gravar")}
            aria-pressed={mode === "gravar"}
            className={`rounded px-3 py-1 text-xs ${mode === "gravar" ? "bg-surface text-ink shadow-sm" : "text-ink-faint"}`}
          >
            Gravar
          </button>
          <button
            type="button"
            onClick={() => setMode("upload")}
            aria-pressed={mode === "upload"}
            className={`rounded px-3 py-1 text-xs ${mode === "upload" ? "bg-surface text-ink shadow-sm" : "text-ink-faint"}`}
          >
            Enviar arquivo
          </button>
        </div>
      </CardHeader>

      <CardBody className="space-y-5">
        {mode === "gravar" ? (
          <div className="flex flex-col items-center gap-5 py-4">
            <p
              className="text-ink font-mono text-4xl tabular-nums"
              aria-live="polite"
              aria-label={`Tempo de gravação: ${formatDuration(seconds)}`}
            >
              {formatDuration(seconds)}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2">
              {status === "idle" || status === "error" ? (
                <Button variant="primary" size="lg" onClick={startRecording}>
                  <Mic size={18} aria-hidden /> Começar a gravar
                </Button>
              ) : null}

              {status === "recording" ? (
                <>
                  <Button variant="secondary" onClick={pauseRecording}>
                    <Pause size={16} aria-hidden /> Pausar
                  </Button>
                  <Button variant="primary" onClick={finishRecording}>
                    <Square size={16} aria-hidden /> Finalizar
                  </Button>
                  <Button variant="ghost" onClick={cancelRecording}>
                    <Trash2 size={16} aria-hidden /> Cancelar
                  </Button>
                </>
              ) : null}

              {status === "paused" ? (
                <>
                  <Button variant="secondary" onClick={resumeRecording}>
                    <Play size={16} aria-hidden /> Continuar
                  </Button>
                  <Button variant="primary" onClick={finishRecording}>
                    <Square size={16} aria-hidden /> Finalizar
                  </Button>
                  <Button variant="ghost" onClick={cancelRecording}>
                    <Trash2 size={16} aria-hidden /> Cancelar
                  </Button>
                </>
              ) : null}
            </div>

            {status === "recording" ? (
              <p className="text-danger flex items-center gap-2 text-sm" role="status">
                <span className="bg-danger h-2 w-2 animate-pulse rounded-full" aria-hidden />
                gravando
              </p>
            ) : null}
          </div>
        ) : (
          <div>
            <input
              type="file"
              accept="audio/*"
              onChange={handleFile}
              aria-label="Escolher arquivo de áudio"
              className="border-line-strong bg-surface file:bg-surface-2 file:text-ink-soft w-full rounded-[var(--radius)] border px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:px-3 file:py-1.5 file:text-sm"
            />
            <Muted className="mt-2 text-xs">
              MP3, M4A, WAV, OGG ou WEBM. O arquivo original fica guardado como você enviou.
            </Muted>
          </div>
        )}

        {blob && previewUrl ? (
          <div className="border-line bg-surface-2 rounded-[var(--radius)] border p-4">
            <p className="text-ink-soft mb-2 text-sm">
              {fileName ?? "Gravação"} · {formatBytes(blob.size)}
            </p>
            <audio src={previewUrl} controls className="w-full" />
          </div>
        ) : null}

        {sending ? <Progress value={progress} label={step ?? "Enviando…"} /> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {blob ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={send} disabled={sending}>
              <Upload size={16} aria-hidden />
              {sending ? "Enviando…" : "Enviar e transcrever"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setBlob(null);
                setPreviewUrl(null);
                setFileName(null);
                setStatus("idle");
              }}
              disabled={sending}
            >
              Descartar
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
