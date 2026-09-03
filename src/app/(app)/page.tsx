import Link from "next/link";
import { AlertTriangle, BookOpen, Loader2, Mic, Upload } from "lucide-react";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  LinkButton,
  Muted,
} from "@/components/ui";
import { aiCapabilities } from "@/lib/env";
import { requireSession } from "@/lib/supabase/server";
import { formatDateTime, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { supabase, workspaceId, displayName } = await requireSession();
  const capabilities = aiCapabilities();

  const [sourcesResult, processingResult, sessionsResult, pendingResult] = await Promise.all([
    supabase
      .from("sources")
      .select("id, status", { count: "exact" })
      .eq("workspace_id", workspaceId),
    supabase
      .from("sources")
      .select("id, title, status")
      .eq("workspace_id", workspaceId)
      .in("status", ["processing", "uploaded", "ocr_required"])
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("reflection_sessions")
      .select("id, central_question, status, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("reflection_sessions")
      .select("id, central_question, status")
      .eq("workspace_id", workspaceId)
      .in("status", ["transcript_review", "needs_conflict_review", "dossier_ready", "editing"])
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  const totalSources = sourcesResult.count ?? 0;
  const readySources = (sourcesResult.data ?? []).filter((s) => s.status === "ready").length;
  const processing = processingResult.data ?? [];
  const sessions = sessionsResult.data ?? [];
  const pending = pendingResult.data ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <p className="text-ink-faint text-sm">{displayName ? `Olá, ${displayName}.` : "Olá."}</p>
        <h1 className="mt-1 font-serif text-[30px] leading-tight tracking-tight">
          O que aconteceu hoje?
        </h1>
        <p className="text-ink-soft mt-2 max-w-xl text-sm">
          Grave um relato. Antes de escrever qualquer coisa, o sistema investiga a sua biblioteca e
          monta um dossiê do que a memória tem a dizer.
        </p>
      </header>

      <Card className="border-accent/30 bg-accent-soft/40 mb-8">
        <CardBody className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-serif text-xl tracking-tight">Nova reflexão</p>
            <Muted className="mt-1">
              Fale sobre um acontecimento, uma dúvida, uma ideia. A revisão é sempre sua.
            </Muted>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/nova-reflexao" variant="primary" size="lg">
              <Mic size={18} aria-hidden /> Começar a gravar
            </LinkButton>
            <LinkButton href="/nova-reflexao?modo=upload" variant="secondary" size="lg">
              <Upload size={18} aria-hidden /> Enviar áudio
            </LinkButton>
          </div>
        </CardBody>
      </Card>

      {capabilities.demoMode ? (
        <div className="mb-8">
          <Alert tone="inference" title="Modo demonstração ativo">
            Um ou mais provedores de IA não estão configurados. O fluxo inteiro funciona — a busca,
            a investigação e o dossiê rodam por heurísticas determinísticas, e a interface deixa
            isso explícito em cada resultado. Configure as chaves em Configurações para ligar a
            análise completa.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-5 md:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-3xl font-light tabular-nums">{totalSources}</p>
            <Muted className="mt-1">documentos na biblioteca</Muted>
            <p className="text-ink-faint mt-3 text-xs">
              {readySources} disponível(is) para a memória
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-3xl font-light tabular-nums">{sessions.length}</p>
            <Muted className="mt-1">sessões recentes</Muted>
            <p className="text-ink-faint mt-3 text-xs">{pending.length} aguardando você</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-3xl font-light tabular-nums">{processing.length}</p>
            <Muted className="mt-1">documentos em processamento</Muted>
            <p className="text-ink-faint mt-3 text-xs">
              {processing.some((p) => p.status === "ocr_required")
                ? "algum precisa de OCR"
                : "nada travado"}
            </p>
          </CardBody>
        </Card>
      </div>

      {pending.length > 0 ? (
        <Card className="mt-8">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Esperando a sua decisão</CardTitle>
            <Badge tone="accent">{pending.length}</Badge>
          </CardHeader>
          <CardBody className="divide-line divide-y p-0">
            {pending.map((session) => (
              <Link
                key={session.id}
                href={`/mesa/${session.id}`}
                className="hover:bg-surface-2 flex items-center justify-between gap-4 px-5 py-3.5 transition-colors"
              >
                <span className="min-w-0">
                  <span className="text-ink block truncate text-sm">
                    {session.central_question ?? "Sessão sem questão definida"}
                  </span>
                  <span className="text-ink-faint mt-0.5 block text-xs">
                    {statusLabel(session.status as string)}
                  </span>
                </span>
                {session.status === "needs_conflict_review" ? (
                  <Badge tone="danger" className="shrink-0">
                    <AlertTriangle size={11} aria-hidden /> conflito
                  </Badge>
                ) : null}
              </Link>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Reflexões recentes</CardTitle>
          </CardHeader>
          <CardBody className={sessions.length ? "divide-line divide-y p-0" : ""}>
            {sessions.length === 0 ? (
              <EmptyState
                title="Nenhuma reflexão ainda"
                description="Quando você gravar o primeiro relato, ele aparece aqui com todo o caminho percorrido."
              />
            ) : (
              sessions.map((session) => (
                <Link
                  key={session.id}
                  href={`/mesa/${session.id}`}
                  className="hover:bg-surface-2 block px-5 py-3.5 transition-colors"
                >
                  <p className="text-ink truncate text-sm">
                    {truncate(session.central_question ?? "Sessão sem questão", 80)}
                  </p>
                  <p className="text-ink-faint mt-0.5 text-xs">
                    {formatDateTime(session.created_at as string)} ·{" "}
                    {statusLabel(session.status as string)}
                  </p>
                </Link>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Biblioteca</CardTitle>
          </CardHeader>
          <CardBody>
            {totalSources === 0 ? (
              <EmptyState
                title="A biblioteca está vazia"
                description="A memória só investiga o que existe. Comece adicionando um livro, um texto seu ou um documento."
                action={
                  <LinkButton href="/biblioteca" variant="primary">
                    <BookOpen size={16} aria-hidden /> Adicionar documento
                  </LinkButton>
                }
              />
            ) : (
              <div className="space-y-3">
                {processing.length > 0 ? (
                  <ul className="space-y-2">
                    {processing.map((source) => (
                      <li key={source.id} className="flex items-center gap-2 text-sm">
                        {source.status === "ocr_required" ? (
                          <AlertTriangle size={14} className="text-danger" aria-hidden />
                        ) : (
                          <Loader2 size={14} className="text-ink-faint animate-spin" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate">{source.title as string}</span>
                        <Badge tone={source.status === "ocr_required" ? "danger" : "neutral"}>
                          {source.status === "ocr_required" ? "precisa de OCR" : "processando"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Muted>Todos os documentos estão indexados e disponíveis para a memória.</Muted>
                )}
                <Link
                  href="/biblioteca"
                  className="text-accent inline-block text-sm underline underline-offset-2"
                >
                  Abrir a biblioteca
                </Link>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "rascunho",
    awaiting_transcription: "transcrevendo",
    transcript_review: "revisar transcrição",
    investigating: "investigando a memória",
    needs_conflict_review: "conflito aguardando decisão",
    dossier_ready: "dossiê pronto",
    writing: "escrevendo",
    editing: "em edição",
    approved: "aprovada",
    failed: "falhou",
    archived: "arquivada",
  };
  return labels[status] ?? status;
}
