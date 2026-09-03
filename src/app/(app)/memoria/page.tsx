import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import {
  AuthorityMeter,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Muted,
  PageHeader,
} from "@/components/ui";
import { searchMemory, type MemoryHit } from "@/features/memory/search";
import { requireSession } from "@/lib/supabase/server";
import { formatDate, truncate } from "@/lib/utils";

export const metadata: Metadata = { title: "Memória" };
export const dynamic = "force-dynamic";

export default async function MemoriaPage(props: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await props.searchParams;
  const { supabase, workspaceId } = await requireSession();

  const query = (q ?? "").trim();
  const result = query ? await searchMemory(supabase, { workspaceId, query }) : null;

  const [
    { count: chunkCount },
    { count: claimCount },
    { count: conceptCount },
    { count: episodeCount },
  ] = await Promise.all([
    supabase
      .from("source_chunks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    supabase
      .from("claims")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    supabase
      .from("concepts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    supabase
      .from("episodes")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Memória"
        description="A Biblioteca guarda o que foi colocado. A Memória mostra o que o sistema consegue recuperar, relacionar e rastrear."
      />

      <Card className="mb-6">
        <CardBody>
          <form action="/memoria" method="get" className="flex gap-2">
            <Input
              name="q"
              defaultValue={query}
              placeholder="permanência, silêncio, lealdade…"
              aria-label="Pesquisar na memória"
            />
            <Button type="submit" variant="primary">
              <Search size={16} aria-hidden /> Pesquisar
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>{chunkCount ?? 0} trechos</Badge>
            <Badge>{claimCount ?? 0} afirmações</Badge>
            <Badge>{conceptCount ?? 0} conceitos</Badge>
            <Badge>{episodeCount ?? 0} relatos</Badge>
          </div>
        </CardBody>
      </Card>

      {!result ? (
        <EmptyState
          title="Pesquise a memória"
          description="Digite um conceito, uma expressão ou uma situação. O resultado traz fontes, trechos, afirmações, relatos e as divergências registradas."
        />
      ) : (
        <div className="space-y-6">
          {result.documents.length === 0 &&
          result.passages.length === 0 &&
          result.claims.length === 0 &&
          result.episodes.length === 0 ? (
            <EmptyState
              title="Nada encontrado"
              description={`A memória não tem registro relacionado a "${result.query}". O sistema declara a ausência em vez de aproximar qualquer coisa.`}
            />
          ) : null}

          <Group title="Fontes relacionadas" hits={result.documents} />
          <Group title="Trechos" hits={result.passages} showSection />
          <Group title="Afirmações rastreáveis" hits={result.claims} />
          <Group title="Relatos seus" hits={result.episodes} />

          {result.concepts.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Conceitos</CardTitle>
              </CardHeader>
              <CardBody className="flex flex-wrap gap-2">
                {result.concepts.map((concept) => (
                  <Badge
                    key={concept.id}
                    tone={
                      concept.status === "confirmed" || concept.status === "active"
                        ? "accent"
                        : "neutral"
                    }
                    title={concept.definition ?? undefined}
                  >
                    {concept.label} · {concept.occurrences}
                    {concept.status === "candidate" ? " (candidato)" : ""}
                  </Badge>
                ))}
              </CardBody>
            </Card>
          ) : null}

          {result.divergences.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Divergências registradas</CardTitle>
              </CardHeader>
              <CardBody className="divide-line divide-y p-0">
                {result.divergences.map((divergence) => (
                  <div key={divergence.id} className="px-5 py-3">
                    <p className="text-ink text-sm">{divergence.title}</p>
                    <p className="text-ink-faint mt-0.5 text-xs">
                      {divergence.kind} · {divergence.severity} · {formatDate(divergence.createdAt)}
                    </p>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  hits,
  showSection,
}: {
  title: string;
  hits: MemoryHit[];
  showSection?: boolean;
}) {
  if (!hits.length) return null;
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Badge>{hits.length}</Badge>
      </CardHeader>
      <CardBody className="divide-line divide-y p-0">
        {hits.map((hit) => (
          <div key={hit.id} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {hit.sourceId ? (
                  <Link
                    href={`/biblioteca/${hit.sourceId}`}
                    className="text-ink text-[13px] font-medium underline-offset-2 hover:underline"
                  >
                    {hit.title}
                  </Link>
                ) : (
                  <p className="text-ink text-[13px] font-medium">{hit.title}</p>
                )}
                {showSection && hit.sectionTitle ? (
                  <Muted className="text-xs">{hit.sectionTitle}</Muted>
                ) : null}
                {hit.occurredOn ? (
                  <Muted className="text-xs">{formatDate(hit.occurredOn)}</Muted>
                ) : null}
              </div>
              {hit.authorityLevel ? <AuthorityMeter level={hit.authorityLevel} /> : null}
            </div>
            <p className="text-ink-soft mt-1.5 text-sm leading-relaxed">
              {truncate(hit.text, 320)}
            </p>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
