import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { SESSION_STATUS_LABELS, sessionStatusTone } from "@/features/reflections/status";
import { requireSession } from "@/lib/supabase/server";
import { formatDateTime, truncate } from "@/lib/utils";

export const metadata: Metadata = { title: "Histórico" };
export const dynamic = "force-dynamic";

export default async function HistoricoPage() {
  const { supabase, workspaceId } = await requireSession();

  const { data } = await supabase
    .from("reflection_sessions")
    .select(
      "id, central_question, status, created_at, " +
        "reflections(id, title, status, reflection_versions(id, version_number, status))",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);

  type Row = {
    id: string;
    central_question: string | null;
    status: string;
    created_at: string;
    reflections: {
      id: string;
      title: string | null;
      status: string;
      reflection_versions: Array<{ id: string; version_number: number; status: string }>;
    } | null;
  };

  const sessions = (data ?? []) as unknown as Row[];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Histórico"
        description="Cada sessão pode ser reconstruída inteira: áudio, transcrição, investigação, dossiê, conflitos, decisões, versões, aprovação e voz."
      />

      <Card>
        <CardBody className={sessions.length ? "divide-line divide-y p-0" : ""}>
          {sessions.length === 0 ? (
            <EmptyState
              title="Nenhuma sessão registrada"
              description="O histórico começa na primeira reflexão."
            />
          ) : (
            sessions.map((session) => {
              const versions = session.reflections?.reflection_versions ?? [];
              const approved = versions.find((v) => v.status === "approved");
              return (
                <div key={session.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-ink text-sm">
                        {truncate(
                          session.reflections?.title ??
                            session.central_question ??
                            "Sessão sem título",
                          90,
                        )}
                      </p>
                      <p className="text-ink-faint mt-0.5 text-xs">
                        {formatDateTime(session.created_at)}
                        {versions.length ? ` · ${versions.length} versão(ões)` : ""}
                        {approved ? " · aprovada" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={sessionStatusTone(session.status)}>
                        {SESSION_STATUS_LABELS[session.status] ?? session.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-2.5 flex gap-3 text-xs">
                    <Link
                      href={`/mesa/${session.id}`}
                      className="text-accent underline underline-offset-2"
                    >
                      Abrir na mesa
                    </Link>
                    <Link
                      href={`/historico/${session.id}`}
                      className="text-accent underline underline-offset-2"
                    >
                      Como a memória chegou aqui?
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </CardBody>
      </Card>
    </div>
  );
}
