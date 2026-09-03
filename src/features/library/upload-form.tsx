"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Muted,
  Progress,
  Select,
} from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { formatBytes } from "@/lib/utils";
import { enqueueIngestion, prepareUpload } from "./actions";

const AUTHORITY_OPTIONS = [
  { value: 5, label: "5 — cânone / princípio aprovado" },
  { value: 4, label: "4 — livro ou texto autoral final" },
  { value: 3, label: "3 — reflexão aprovada" },
  { value: 2, label: "2 — anotação" },
  { value: 1, label: "1 — rascunho" },
];

type Phase = "idle" | "preparing" | "uploading" | "processing" | "done" | "error";

export function UploadForm({ maxBytes }: { maxBytes: number }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const form = event.currentTarget;
    const data = new FormData(form);
    const chosen = fileRef.current?.files?.[0];

    if (!chosen) {
      setError("Escolha um arquivo.");
      return;
    }
    if (chosen.size > maxBytes) {
      setError(`O arquivo tem ${formatBytes(chosen.size)} e o limite é ${formatBytes(maxBytes)}.`);
      return;
    }

    try {
      setPhase("preparing");
      setProgress(10);

      const prepared = await prepareUpload({
        title: String(data.get("title") ?? "").trim() || chosen.name,
        authors: String(data.get("authors") ?? ""),
        kind: String(data.get("kind") ?? "book"),
        category: String(data.get("category") ?? ""),
        authorityLevel: String(data.get("authorityLevel") ?? "4"),
        filename: chosen.name,
        mimeType: chosen.type || guessMime(chosen.name),
        byteSize: chosen.size,
      });

      if (!prepared.ok) {
        setPhase("error");
        setError(prepared.error);
        return;
      }

      setPhase("uploading");
      setProgress(35);

      const supabase = getBrowserSupabase();
      const { error: uploadError } = await supabase.storage
        .from(prepared.bucket)
        .upload(prepared.path, chosen, {
          contentType: chosen.type || guessMime(chosen.name),
          upsert: true,
        });

      if (uploadError) {
        setPhase("error");
        setError(`Falha ao enviar o arquivo: ${uploadError.message}`);
        return;
      }

      setPhase("processing");
      setProgress(55);
      setMessage("Arquivo salvo. Processando o texto, a estrutura e a memória…");

      await enqueueIngestion(prepared.sourceVersionId);

      const response = await fetch("/api/jobs/run", { method: "POST" });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        setPhase("error");
        setError(`O documento foi salvo, mas o processamento falhou: ${detail.slice(0, 300)}`);
        return;
      }

      setProgress(100);
      setPhase("done");
      setMessage("Documento processado e disponível na memória.");
      form.reset();
      setFile(null);
      router.refresh();
    } catch (caught) {
      setPhase("error");
      setError(caught instanceof Error ? caught.message : "Erro inesperado.");
    }
  }

  const busy = phase === "preparing" || phase === "uploading" || phase === "processing";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Adicionar à biblioteca</CardTitle>
        <Muted className="mt-1">
          PDF com texto, DOCX, TXT ou Markdown. O arquivo original é preservado; o texto extraído e
          as estruturas derivadas ficam separados dele.
        </Muted>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="file">Arquivo</Label>
            <input
              ref={fileRef}
              id="file"
              name="file"
              type="file"
              accept=".pdf,.docx,.txt,.md,.markdown"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="border-line-strong bg-surface file:bg-surface-2 file:text-ink-soft w-full rounded-[var(--radius)] border px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:px-3 file:py-1.5 file:text-sm"
            />
            {file ? (
              <Muted className="mt-1.5 text-xs">
                {file.name} · {formatBytes(file.size)}
              </Muted>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="title">Título</Label>
              <Input id="title" name="title" placeholder="Ex.: A permanência" />
            </div>
            <div>
              <Label htmlFor="authors">Autor(es)</Label>
              <Input id="authors" name="authors" placeholder="separados por vírgula" />
            </div>
            <div>
              <Label htmlFor="kind">Tipo</Label>
              <Select id="kind" name="kind" defaultValue="book">
                <option value="book">Livro</option>
                <option value="article">Artigo</option>
                <option value="authored_text">Texto autoral meu</option>
                <option value="document">Documento</option>
                <option value="note">Anotação</option>
                <option value="imported_reflection">Reflexão importada</option>
                <option value="other">Outro</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="authorityLevel">Autoridade da fonte</Label>
              <Select id="authorityLevel" name="authorityLevel" defaultValue="4">
                {AUTHORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="category">Categoria</Label>
            <Input id="category" name="category" placeholder="Ex.: filosofia, memória, família" />
          </div>

          {busy ? (
            <Progress
              value={progress}
              label={
                phase === "preparing"
                  ? "Preparando…"
                  : phase === "uploading"
                    ? "Enviando o arquivo…"
                    : "Processando o documento — isso pode levar alguns minutos."
              }
            />
          ) : null}

          {error ? <Alert tone="danger">{error}</Alert> : null}
          {message && !error ? (
            <Alert tone={phase === "done" ? "success" : "neutral"}>{message}</Alert>
          ) : null}

          <Button type="submit" variant="primary" disabled={busy}>
            <Upload size={16} aria-hidden />
            {busy ? "Processando…" : "Adicionar documento"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function guessMime(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === "md" || extension === "markdown") return "text/markdown";
  return "text/plain";
}
