"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PenLine } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Muted,
  Textarea,
} from "@/components/ui";
import { createTextSession } from "./actions";

/** Nem todo relato começa em áudio. O fluxo editorial é o mesmo. */
export function TextSessionForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await createTextSession(text);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push(`/mesa/${result.data.sessionId}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ou escreva o relato</CardTitle>
        <Muted className="mt-1">
          Conte o acontecimento, a dúvida ou a ideia como você contaria em voz alta.
        </Muted>
      </CardHeader>
      <CardBody className="space-y-4">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Hoje eu percebi que…"
          aria-label="Relato escrito"
        />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button variant="primary" onClick={submit} disabled={busy || text.trim().length < 20}>
          <PenLine size={16} aria-hidden />
          {busy ? "Abrindo…" : "Seguir para a revisão"}
        </Button>
      </CardBody>
    </Card>
  );
}
