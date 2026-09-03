import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import {
  Alert,
  AuthorityMeter,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Muted,
} from "@/components/ui";
import { SourceActions } from "@/features/library/source-actions";
import { requireSession } from "@/lib/supabase/server";
import { formatBytes, formatDateTime, truncate } from "@/lib/utils";

export const metadata: Metadata = { title: "Documento" };
export const dynamic = "force-dynamic";

export default async function DocumentoPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { supabase, workspaceId } = await requireSession();

  const { data: source } = await supabase
    .from("sources")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!source) notFound();

  const [
    versionResult,
    sectionsResult,
    summaryResult,
    chunksResult,
    conceptsResult,
    claimsResult,
    embeddingsResult,
  ] = await Promise.all([
    supabase
      .from("source_versions")
      .select("*")
      .eq("source_id", id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("source_sections")
      .select("id, title, level, sequence, page_start, page_end, token_count")
      .eq("source_id", id)
      .order("sequence"),
    supabase
      .from("source_summaries")
      .select("id, scope, summary, key_points, themes, model")
      .eq("source_id", id)
      .eq("scope", "global")
      .maybeSingle(),
    supabase
      .from("source_chunks")
      .select("id, sequence, text, page_start, token_count", { count: "exact" })
      .eq("source_id", id)
      .order("sequence")
      .limit(5),
    supabase
      .from("source_concepts")
      .select("weight, concepts(id, label, status, occurrences)")
      .eq("source_id", id)
      .limit(30),
    supabase
      .from("claims")
      .select("id, text, kind, confidence, status", { count: "exact" })
      .eq("source_id", id)
      .order("confidence", { ascending: false })
      .limit(8),
    supabase.from("embeddings").select("id", { count: "exact", head: true }).eq("source_id", id),
  ]);

  const version = versionResult.data;
  const sections = sectionsResult.data ?? [];
  const summary = summaryResult.data;
  const chunks = chunksResult.data ?? [];
  const concepts = (conceptsResult.data ?? []) as unknown as Array<{
    weight: number;
    concepts: { id: string; label: string; status: string; occurrences: number } | null;
  }>;
  const claims = claimsResult.data ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/biblioteca"
        className="text-ink-faint hover:text-ink mb-5 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft size={15} aria-hidden /> Biblioteca
      </Link>

      <header className="mb-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-[28px] leading-tight tracking-tight">
              {source.title as string}
            </h1>
            <p className="text-ink-faint mt-1.5 text-sm">
              {(source.authors as string[] | null)?.join(", ") || "sem autor informado"}
              {source.category ? ` · ${source.category}` : ""}
            </p>
          </div>
          <AuthorityMeter level={source.authority_level as number} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge tone={source.status === "ready" ? "success" : "neutral"}>
            {source.status as string}
          </Badge>
          {!source.is_active ? <Badge tone="inference">fora da memória</Badge> : null}
          <Badge>{sections.length} seções</Badge>
          <Badge>{chunksResult.count ?? 0} trechos</Badge>
          <Badge>{embeddingsResult.count ?? 0} vetores</Badge>
          <Badge>{claimsResult.count ?? 0} afirmações</Badge>
        </div>
      </header>

      {version?.extraction_status === "ocr_required" ? (
        <div className="mb-6">
          <Alert tone="danger" title="Este documento precisa de OCR">
            {version.extraction_notes ??
              "O texto extraído não é utilizável. O documento não entra na memória para não " +
                "contaminá-la com texto ruim."}
          </Alert>
        </div>
      ) : null}

      {version?.extraction_status === "ocr_low_confidence" ? (
        <div className="mb-6">
          <Alert tone="inference" title="Qualidade de extração baixa">
            {version.extraction_notes}
          </Alert>
        </div>
      ) : null}

      <div className="mb-6">
        <SourceActions
          sourceId={id}
          title={source.title as string}
          authorityLevel={source.authority_level as number}
          isActive={source.is_active as boolean}
          category={(source.category as string | null) ?? ""}
        />
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Arquivo original</CardTitle>
          </CardHeader>
          <CardBody className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Field label="Nome" value={(version?.original_filename as string) ?? "—"} />
            <Field label="Tipo" value={(version?.mime_type as string) ?? "—"} />
            <Field
              label="Tamanho"
              value={version?.byte_size ? formatBytes(version.byte_size as number) : "—"}
            />
            <Field label="Páginas" value={String(version?.page_count ?? "—")} />
            <Field
              label="Qualidade da extração"
              value={
                version?.extraction_quality != null
                  ? `${((version.extraction_quality as number) * 100).toFixed(0)}%`
                  : "—"
              }
            />
            <Field
              label="Motor de extração"
              value={(version?.extraction_engine as string) ?? "—"}
            />
            <Field label="Caracteres" value={String(version?.char_count ?? "—")} />
            <Field label="Enviado em" value={formatDateTime(source.created_at as string)} />
            <Field
              label="SHA-256"
              value={version?.sha256 ? `${(version.sha256 as string).slice(0, 16)}…` : "—"}
            />
            <Field label="Estrutura" value={(version?.structure_status as string) ?? "—"} />
          </CardBody>
        </Card>

        {summary ? (
          <Card>
            <CardHeader>
              <CardTitle>Resumo global</CardTitle>
              <Muted className="mt-1 text-xs">
                Usado na primeira etapa da busca: é assim que este documento participa da seleção
                global. {summary.model ? `Gerado por ${summary.model}.` : ""}
              </Muted>
            </CardHeader>
            <CardBody>
              <p className="text-ink-soft text-sm leading-relaxed">{summary.summary as string}</p>
              {(summary.themes as string[])?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(summary.themes as string[]).map((theme) => (
                    <Badge key={theme}>{theme}</Badge>
                  ))}
                </div>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        {sections.length > 1 ? (
          <Card>
            <CardHeader>
              <CardTitle>Estrutura</CardTitle>
            </CardHeader>
            <CardBody className="max-h-80 overflow-y-auto">
              <ol className="space-y-1 text-sm">
                {sections.map((section) => (
                  <li
                    key={section.id}
                    style={{ paddingLeft: `${((section.level as number) - 1) * 14}px` }}
                    className="border-line/60 flex items-baseline justify-between gap-3 border-b py-1.5"
                  >
                    <span className="text-ink-soft min-w-0 truncate">
                      {(section.title as string) ?? "—"}
                    </span>
                    <span className="text-ink-faint shrink-0 text-xs tabular-nums">
                      {section.page_start ? `p. ${section.page_start}` : ""}{" "}
                      {section.token_count ? `· ${section.token_count} tk` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        ) : null}

        {concepts.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Conceitos extraídos</CardTitle>
              <Muted className="mt-1 text-xs">
                Inferências da IA nascem como candidatas — nunca viram verdade permanente sozinhas.
              </Muted>
            </CardHeader>
            <CardBody className="flex flex-wrap gap-2">
              {concepts.map((row) =>
                row.concepts ? (
                  <Badge
                    key={row.concepts.id}
                    tone={row.concepts.status === "candidate" ? "neutral" : "accent"}
                  >
                    {row.concepts.label}
                    {row.concepts.status === "candidate" ? " ·  candidato" : ""}
                  </Badge>
                ) : null,
              )}
            </CardBody>
          </Card>
        ) : null}

        {claims.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Afirmações rastreáveis</CardTitle>
              <Muted className="mt-1 text-xs">
                Cada afirmação guarda a citação literal do trecho de origem.
              </Muted>
            </CardHeader>
            <CardBody className="divide-line divide-y p-0">
              {claims.map((claim) => (
                <div key={claim.id} className="px-5 py-3">
                  <p className="text-ink-soft text-sm">{claim.text as string}</p>
                  <div className="mt-1.5 flex gap-1.5">
                    <Badge>{claim.kind as string}</Badge>
                    <Badge tone={(claim.status as string) === "candidate" ? "neutral" : "accent"}>
                      {claim.status as string}
                    </Badge>
                    <Badge>confiança {Number(claim.confidence).toFixed(2)}</Badge>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        ) : null}

        {chunks.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Primeiros trechos</CardTitle>
              <Muted className="mt-1 text-xs">
                {chunksResult.count ?? 0} trechos no total, divididos por estrutura — nunca a cada X
                caracteres.
              </Muted>
            </CardHeader>
            <CardBody className="divide-line divide-y p-0">
              {chunks.map((chunk) => (
                <div key={chunk.id} className="px-5 py-3">
                  <p className="text-ink-faint mb-1 text-xs">
                    #{chunk.sequence as number}
                    {chunk.page_start ? ` · página ${chunk.page_start}` : ""} ·{" "}
                    {chunk.token_count as number} tokens
                  </p>
                  <p className="text-ink-soft text-sm leading-relaxed">
                    {truncate(chunk.text as string, 320)}
                  </p>
                </div>
              ))}
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line/60 flex justify-between gap-3 border-b py-1.5">
      <span className="text-ink-faint">{label}</span>
      <span className="text-ink-soft truncate text-right">{value}</span>
    </div>
  );
}
