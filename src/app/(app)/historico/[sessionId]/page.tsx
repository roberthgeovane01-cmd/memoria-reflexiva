import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import {
  AuthorityMeter,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Muted,
} from "@/components/ui";
import { CONFLICT_KIND_LABELS } from "@/features/reflections/status";
import { requireSession } from "@/lib/supabase/server";
import { formatDateTime, truncate } from "@/lib/utils";

export const metadata: Metadata = { title: "Auditoria da memória" };
export const dynamic = "force-dynamic";

/**
 * "Como a memória chegou a esta reflexão?"
 *
 * Mostra as consultas, os documentos, os capítulos, os trechos, os scores, as
 * evidências, as fontes descartadas, as fontes utilizadas e os conflitos.
 * A promessa do produto é poder demonstrar por que o sistema acredita saber
 * o que diz — esta tela é a prova.
 */
export default async function AuditoriaPage(props: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await props.params;
  const { supabase, workspaceId } = await requireSession();

  const { data: session } = await supabase
    .from("reflection_sessions")
    .select("id, central_question, status, created_at, retrieval_session_id, dossier_id")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!session) notFound();

  if (!session.retrieval_session_id) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink sessionId={sessionId} />
        <EmptyState
          title="Esta sessão ainda não investigou a memória"
          description="A trilha de auditoria aparece depois que a investigação roda."
        />
      </div>
    );
  }

  const [retrievalResult, queriesResult, hitsResult, conflictsResult, auditResult] =
    await Promise.all([
      supabase
        .from("retrieval_sessions")
        .select("*")
        .eq("id", session.retrieval_session_id)
        .maybeSingle(),
      supabase
        .from("retrieval_queries")
        .select("id, sequence, text, rationale, level, strategy")
        .eq("retrieval_session_id", session.retrieval_session_id)
        .order("sequence"),
      supabase
        .from("retrieval_hits")
        .select(
          "id, owner_kind, level, selected, discard_reason, snippet, authority_level, " +
            "vector_score, fulltext_score, fusion_score, rerank_score, final_score, " +
            "diversity_penalty, explanation, sources(title)",
        )
        .eq("retrieval_session_id", session.retrieval_session_id)
        .order("final_score", { ascending: false })
        .limit(200),
      supabase
        .from("conflicts")
        .select("id, kind, severity, title, status, conflict_resolutions(decision, decided_at)")
        .eq("reflection_session_id", sessionId),
      supabase
        .from("audit_logs")
        .select(
          "id, action, provider, model, latency_ms, tokens_in, tokens_out, estimated_cost, created_at, metadata",
        )
        .eq("workspace_id", workspaceId)
        .in("entity_id", [session.retrieval_session_id, session.dossier_id].filter(Boolean))
        .order("created_at", { ascending: true }),
    ]);

  const retrieval = retrievalResult.data;
  const queries = queriesResult.data ?? [];

  type HitRow = {
    id: string;
    owner_kind: string;
    level: string;
    selected: boolean;
    discard_reason: string | null;
    snippet: string | null;
    authority_level: number | null;
    vector_score: number | null;
    fulltext_score: number | null;
    fusion_score: number | null;
    rerank_score: number | null;
    final_score: number | null;
    diversity_penalty: number | null;
    explanation: Record<string, unknown> | null;
    sources: { title: string } | null;
  };

  const hits = (hitsResult.data ?? []) as unknown as HitRow[];
  const selected = hits.filter((h) => h.selected);
  const discarded = hits.filter((h) => !h.selected);
  const plan = (retrieval?.plan ?? {}) as {
    central_question?: string;
    intent?: string;
    themes?: string[];
    entities?: string[];
    contrasts?: string[];
  };
  const stats = (retrieval?.stats ?? {}) as Record<string, number | boolean>;

  return (
    <div className="mx-auto max-w-4xl">
      <BackLink sessionId={sessionId} />

      <header className="mb-7">
        <h1 className="font-serif text-[26px] leading-snug tracking-tight">
          Como a memória chegou a esta reflexão
        </h1>
        <p className="text-ink-soft mt-2 text-sm">
          {session.central_question ?? "Sessão sem questão definida"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{queries.length} consultas</Badge>
          <Badge>{hits.length} resultados avaliados</Badge>
          <Badge tone="success">{selected.length} utilizados</Badge>
          <Badge tone="neutral">{discarded.length} descartados</Badge>
          {typeof stats.diversity === "number" ? (
            <Badge>diversidade {(stats.diversity * 100).toFixed(0)}%</Badge>
          ) : null}
          {stats.demo ? <Badge tone="inference">modo demonstração</Badge> : null}
        </div>
      </header>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>1. O que o sistema entendeu</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label="Questão central" value={plan.central_question ?? "—"} />
            <Row label="Intenção" value={plan.intent ?? "—"} />
            <Row label="Temas" value={plan.themes?.join(", ") || "—"} />
            <Row label="Entidades mencionadas" value={plan.entities?.join(", ") || "—"} />
            <Row label="Contrastes" value={plan.contrasts?.join(", ") || "—"} />
            <Row label="Modelo do planejador" value={(retrieval?.planner_model as string) ?? "—"} />
            <Row label="Reranking" value={(retrieval?.reranker as string) ?? "—"} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. As consultas executadas</CardTitle>
            <Muted className="mt-1 text-xs">
              Um relato vira várias linhas de pesquisa, em três níveis mais a busca direta.
            </Muted>
          </CardHeader>
          <CardBody className="divide-line divide-y p-0">
            {queries.map((query) => (
              <div key={query.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-ink text-sm">{query.text as string}</p>
                  <Badge className="shrink-0">{query.level as string}</Badge>
                </div>
                <Muted className="mt-0.5 text-xs">{query.rationale as string}</Muted>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Evidências utilizadas</CardTitle>
          </CardHeader>
          <CardBody className="divide-line divide-y p-0">
            {selected.map((hit) => (
              <HitRowView key={hit.id} hit={hit} />
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4. O que foi descartado, e por quê</CardTitle>
            <Muted className="mt-1 text-xs">
              Guardar o descarte é o que permite auditar o ranking depois.
            </Muted>
          </CardHeader>
          <CardBody className="divide-line max-h-96 divide-y overflow-y-auto p-0">
            {discarded.slice(0, 60).map((hit) => (
              <HitRowView key={hit.id} hit={hit} />
            ))}
          </CardBody>
        </Card>

        {(conflictsResult.data ?? []).length ? (
          <Card>
            <CardHeader>
              <CardTitle>5. Conflitos e decisões</CardTitle>
            </CardHeader>
            <CardBody className="divide-line divide-y p-0">
              {(conflictsResult.data ?? []).map((conflict) => {
                const resolutions = (conflict.conflict_resolutions ?? []) as Array<{
                  decision: string;
                  decided_at: string;
                }>;
                return (
                  <div key={conflict.id as string} className="px-5 py-3">
                    <p className="text-ink text-sm">{conflict.title as string}</p>
                    <p className="text-ink-faint mt-0.5 text-xs">
                      {CONFLICT_KIND_LABELS[conflict.kind as string] ?? conflict.kind} ·{" "}
                      {conflict.severity as string} ·{" "}
                      {resolutions.length
                        ? `decidido em ${formatDateTime(resolutions[0].decided_at)}: ${resolutions[0].decision}`
                        : "sem decisão registrada"}
                    </p>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>6. Chamadas de IA nesta sessão</CardTitle>
            <Muted className="mt-1 text-xs">
              Metadados apenas — nenhum conteúdo pessoal vai para o log.
            </Muted>
          </CardHeader>
          <CardBody className="divide-line divide-y p-0">
            {(auditResult.data ?? []).map((entry) => (
              <div
                key={entry.id as string}
                className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5 text-xs"
              >
                <span className="text-ink font-medium">{entry.action as string}</span>
                <span className="text-ink-faint">{(entry.model as string) ?? "—"}</span>
                <span className="text-ink-faint">{entry.latency_ms ?? "—"} ms</span>
                <span className="text-ink-faint">
                  {entry.tokens_in ?? 0} → {entry.tokens_out ?? 0} tokens
                </span>
                {entry.estimated_cost ? (
                  <span className="text-ink-faint">
                    ≈ US$ {Number(entry.estimated_cost).toFixed(4)}
                  </span>
                ) : null}
                <span className="text-ink-faint ml-auto">
                  {formatDateTime(entry.created_at as string)}
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function HitRowView({
  hit,
}: {
  hit: {
    id: string;
    owner_kind: string;
    snippet: string | null;
    authority_level: number | null;
    vector_score: number | null;
    fulltext_score: number | null;
    fusion_score: number | null;
    rerank_score: number | null;
    final_score: number | null;
    diversity_penalty: number | null;
    discard_reason: string | null;
    sources: { title: string } | null;
  };
}) {
  return (
    <div className="px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-ink min-w-0 truncate text-[13px] font-medium">
          {hit.sources?.title ?? hit.owner_kind}
        </p>
        {hit.authority_level ? <AuthorityMeter level={hit.authority_level} /> : null}
      </div>
      <p className="text-ink-soft mt-1 text-xs leading-relaxed">
        {truncate(hit.snippet ?? "", 200)}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
        <Badge>vetorial {(hit.vector_score ?? 0).toFixed(3)}</Badge>
        <Badge>textual {(hit.fulltext_score ?? 0).toFixed(3)}</Badge>
        <Badge>fusão {(hit.fusion_score ?? 0).toFixed(4)}</Badge>
        <Badge>rerank {(hit.rerank_score ?? 0).toFixed(3)}</Badge>
        <Badge>final {(hit.final_score ?? 0).toFixed(3)}</Badge>
        {hit.diversity_penalty ? (
          <Badge tone="inference">penalidade {(hit.diversity_penalty ?? 0).toFixed(2)}</Badge>
        ) : null}
        {hit.discard_reason ? <Badge tone="neutral">{hit.discard_reason}</Badge> : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line/60 flex justify-between gap-4 border-b py-1.5">
      <span className="text-ink-faint shrink-0">{label}</span>
      <span className="text-ink-soft text-right">{value}</span>
    </div>
  );
}

function BackLink({ sessionId }: { sessionId: string }) {
  return (
    <Link
      href={`/mesa/${sessionId}`}
      className="text-ink-faint hover:text-ink mb-5 inline-flex items-center gap-1.5 text-sm"
    >
      <ArrowLeft size={15} aria-hidden /> Voltar para a mesa
    </Link>
  );
}
