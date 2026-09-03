import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, FileText, Loader2 } from "lucide-react";
import {
  AuthorityMeter,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Muted,
  PageHeader,
} from "@/components/ui";
import { UploadForm } from "@/features/library/upload-form";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Biblioteca" };
export const dynamic = "force-dynamic";

type SourceRow = {
  id: string;
  title: string;
  authors: string[] | null;
  kind: string;
  category: string | null;
  authority_level: number;
  status: string;
  is_active: boolean;
  created_at: string;
  source_versions: Array<{
    extraction_status: string;
    extraction_quality: number | null;
    page_count: number | null;
  }> | null;
};

export default async function BibliotecaPage() {
  const { supabase, workspaceId } = await requireSession();

  const { data } = await supabase
    .from("sources")
    .select(
      "id, title, authors, kind, category, authority_level, status, is_active, created_at, " +
        "source_versions(extraction_status, extraction_quality, page_count)",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  const sources = (data ?? []) as unknown as SourceRow[];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Biblioteca"
        description="O que foi colocado no sistema. O arquivo original é sempre preservado — o texto extraído e as estruturas derivadas vivem separados dele."
      />

      <div className="mb-8">
        <UploadForm maxBytes={env().MAX_DOCUMENT_BYTES} />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Documentos</CardTitle>
          <Badge>{sources.length}</Badge>
        </CardHeader>
        <CardBody className={sources.length ? "divide-line divide-y p-0" : ""}>
          {sources.length === 0 ? (
            <EmptyState
              title="Nada aqui ainda"
              description="A memória só investiga o que existe. Adicione um livro, um texto seu ou um documento acima."
            />
          ) : (
            sources.map((source) => {
              const version = source.source_versions?.[0];
              return (
                <Link
                  key={source.id}
                  href={`/biblioteca/${source.id}`}
                  className="hover:bg-surface-2 block px-5 py-4 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-ink truncate font-serif text-[17px] leading-snug">
                        {source.title}
                      </p>
                      <p className="text-ink-faint mt-1 truncate text-sm">
                        {source.authors?.length ? source.authors.join(", ") : "sem autor informado"}
                        {source.category ? ` · ${source.category}` : ""}
                        {version?.page_count ? ` · ${version.page_count} páginas` : ""}
                      </p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <StatusBadge status={source.status} />
                        <Badge>{kindLabel(source.kind)}</Badge>
                        {!source.is_active ? <Badge tone="neutral">fora da memória</Badge> : null}
                        {version?.extraction_quality != null && version.extraction_quality < 0.6 ? (
                          <Badge tone="inference">
                            extração {(version.extraction_quality * 100).toFixed(0)}%
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <AuthorityMeter level={source.authority_level} />
                      <Muted className="text-xs">{formatDate(source.created_at)}</Muted>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ready")
    return (
      <Badge tone="success">
        <CheckCircle2 size={11} aria-hidden /> na memória
      </Badge>
    );
  if (status === "ocr_required")
    return (
      <Badge tone="danger">
        <AlertTriangle size={11} aria-hidden /> precisa de OCR
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge tone="danger">
        <AlertTriangle size={11} aria-hidden /> falhou
      </Badge>
    );
  if (status === "processing" || status === "uploaded")
    return (
      <Badge tone="neutral">
        <Loader2 size={11} className="animate-spin" aria-hidden /> processando
      </Badge>
    );
  return (
    <Badge>
      <FileText size={11} aria-hidden /> {status}
    </Badge>
  );
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    book: "livro",
    article: "artigo",
    document: "documento",
    authored_text: "texto autoral",
    imported_reflection: "reflexão importada",
    note: "anotação",
    transcript: "transcrição",
    other: "outro",
  };
  return labels[kind] ?? kind;
}
