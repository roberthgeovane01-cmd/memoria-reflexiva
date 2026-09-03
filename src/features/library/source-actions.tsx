"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw, Save, Trash2 } from "lucide-react";
import { Alert, Button, Card, CardBody, Input, Label, Select } from "@/components/ui";
import { deleteSource, reprocessSource, updateSourceMetadata } from "./actions";

export function SourceActions({
  sourceId,
  title,
  authorityLevel,
  isActive,
  category,
}: {
  sourceId: string;
  title: string;
  authorityLevel: number;
  isActive: boolean;
  category: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ title, authorityLevel, isActive, category });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateSourceMetadata(sourceId, form);
        setMessage("Alterações salvas.");
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Falhou.");
      }
    });
  }

  function reprocess() {
    setError(null);
    setMessage("Reprocessando o documento…");
    startTransition(async () => {
      try {
        await reprocessSource(sourceId);
        const response = await fetch("/api/jobs/run", { method: "POST" });
        if (!response.ok) throw new Error(await response.text());
        setMessage("Documento reprocessado.");
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Falhou.");
        setMessage(null);
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteSource(sourceId);
        router.push("/biblioteca");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Falhou.");
      }
    });
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="src-title">Título</Label>
            <Input
              id="src-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="src-authority">Autoridade</Label>
            <Select
              id="src-authority"
              value={form.authorityLevel}
              onChange={(e) => setForm({ ...form, authorityLevel: Number(e.target.value) })}
            >
              <option value={5}>5 — cânone / princípio aprovado</option>
              <option value={4}>4 — livro ou texto autoral final</option>
              <option value={3}>3 — reflexão aprovada</option>
              <option value={2}>2 — anotação</option>
              <option value={1}>1 — rascunho</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="src-category">Categoria</Label>
            <Input
              id="src-category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <label className="text-ink-soft flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Participa da memória
            </label>
          </div>
        </div>

        {error ? <Alert tone="danger">{error}</Alert> : null}
        {message && !error ? <Alert tone="success">{message}</Alert> : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={save} disabled={pending}>
            <Save size={14} aria-hidden /> Salvar
          </Button>
          <Button variant="secondary" size="sm" onClick={reprocess} disabled={pending}>
            <RefreshCw size={14} aria-hidden /> Reprocessar
          </Button>
          {confirming ? (
            <>
              <Button variant="danger" size="sm" onClick={remove} disabled={pending}>
                Confirmar exclusão definitiva
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(true)}
              disabled={pending}
            >
              <Trash2 size={14} aria-hidden /> Excluir
            </Button>
          )}
        </div>

        {confirming ? (
          <Alert tone="danger" title="Isso remove tudo">
            O arquivo original, o texto extraído, as seções, os resumos, os trechos, os vetores, os
            conceitos e as afirmações deste documento serão apagados. Não dá para desfazer.
          </Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}
