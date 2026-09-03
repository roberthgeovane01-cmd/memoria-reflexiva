import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, CardBody, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/supabase/server";
import { formatDateTime, truncate } from "@/lib/utils";
import { SESSION_STATUS_LABELS, sessionStatusTone } from "@/features/reflections/status";

export const metadata: Metadata = { title: "Mesa de revisão" };
export const dynamic = "force-dynamic";

export default async function MesaPage() {
  const { supabase, workspaceId } = await requireSession();

  const { data } = await supabase
    .from("reflection_sessions")
    .select("id, central_question, status, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(50);

  const sessions = data ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Mesa de revisão"
        description="Cada sessão passa por fala, memória, conflito e reflexão. Nada avança sem a sua decisão."
        actions={
          <LinkButton href="/nova-reflexao" variant="primary">
            Nova reflexão
          </LinkButton>
        }
      />

      <Card>
        <CardBody className={sessions.length ? "divide-line divide-y p-0" : ""}>
          {sessions.length === 0 ? (
            <EmptyState
              title="Nenhuma sessão aberta"
              description="Grave um relato para abrir a primeira sessão editorial."
              action={
                <LinkButton href="/nova-reflexao" variant="primary">
                  Começar
                </LinkButton>
              }
            />
          ) : (
            sessions.map((session) => (
              <Link
                key={session.id}
                href={`/mesa/${session.id}`}
                className="hover:bg-surface-2 flex items-center justify-between gap-4 px-5 py-4 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-ink truncate text-sm">
                    {truncate(
                      (session.central_question as string) ?? "Sessão sem questão definida",
                      90,
                    )}
                  </p>
                  <p className="text-ink-faint mt-0.5 text-xs">
                    {formatDateTime(session.created_at as string)}
                  </p>
                </div>
                <Badge tone={sessionStatusTone(session.status as string)} className="shrink-0">
                  {SESSION_STATUS_LABELS[session.status as string] ?? session.status}
                </Badge>
              </Link>
            ))
          )}
        </CardBody>
      </Card>
    </div>
  );
}
