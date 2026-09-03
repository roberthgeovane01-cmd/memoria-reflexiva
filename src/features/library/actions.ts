"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/supabase/server";
import { sanitizeFilename, slugify } from "@/lib/utils";
import { SUPPORTED_MIME_TYPES } from "@/services/ingestion/extract";

const ALLOWED_EXTENSIONS = ["pdf", "docx", "txt", "md", "markdown"];

const prepareSchema = z.object({
  title: z.string().min(2, "Dê um título ao documento."),
  authors: z.string().optional(),
  kind: z.enum([
    "book",
    "article",
    "document",
    "authored_text",
    "imported_reflection",
    "note",
    "other",
  ]),
  category: z.string().optional(),
  authorityLevel: z.coerce.number().int().min(1).max(5),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.coerce.number().int().positive(),
});

export type PrepareUploadResult =
  | { ok: true; sourceId: string; sourceVersionId: string; bucket: string; path: string }
  | { ok: false; error: string };

/**
 * Cria os registros da fonte e devolve o caminho privado no Storage.
 * O arquivo em si sobe direto do navegador para o Supabase, sob RLS.
 */
export async function prepareUpload(input: unknown): Promise<PrepareUploadResult> {
  const parsed = prepareSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;

  // Validação de segurança do upload: extensão, MIME e tamanho.
  const extension = data.filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return {
      ok: false,
      error: `Formato não suportado (.${extension}). Aceitos: PDF, DOCX, TXT e Markdown.`,
    };
  }
  if (!SUPPORTED_MIME_TYPES.includes(data.mimeType as (typeof SUPPORTED_MIME_TYPES)[number])) {
    return { ok: false, error: `Tipo de arquivo não aceito (${data.mimeType}).` };
  }
  const maxBytes = env().MAX_DOCUMENT_BYTES;
  if (data.byteSize > maxBytes) {
    return {
      ok: false,
      error: `Arquivo maior que o limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`,
    };
  }

  const { supabase, workspaceId, userId } = await requireSession();

  const { data: source, error: sourceError } = await supabase
    .from("sources")
    .insert({
      workspace_id: workspaceId,
      title: data.title,
      authors: data.authors
        ? data.authors
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
      kind: data.kind,
      category: data.category || null,
      authority_level: data.authorityLevel,
      status: "uploaded",
      created_by: userId,
    })
    .select("id")
    .single();
  if (sourceError) return { ok: false, error: sourceError.message };

  const sourceId = source.id as string;
  const safeName = sanitizeFilename(data.filename);
  const path = `${workspaceId}/sources/${sourceId}/${safeName}`;

  const { data: version, error: versionError } = await supabase
    .from("source_versions")
    .insert({
      workspace_id: workspaceId,
      source_id: sourceId,
      version_number: 1,
      storage_bucket: "library-originals",
      storage_path: path,
      original_filename: safeName,
      mime_type: data.mimeType,
      byte_size: data.byteSize,
      created_by: userId,
    })
    .select("id")
    .single();
  if (versionError) return { ok: false, error: versionError.message };

  await supabase.from("sources").update({ current_version_id: version.id }).eq("id", sourceId);

  return {
    ok: true,
    sourceId,
    sourceVersionId: version.id as string,
    bucket: "library-originals",
    path,
  };
}

/** Enfileira a ingestão do documento recém-enviado. */
export async function enqueueIngestion(sourceVersionId: string): Promise<{ jobId: string }> {
  const { supabase, workspaceId, userId } = await requireSession();

  const { data, error } = await supabase
    .from("processing_jobs")
    .upsert(
      {
        workspace_id: workspaceId,
        kind: "ingest_source",
        payload: { source_version_id: sourceVersionId },
        idempotency_key: `ingest:${sourceVersionId}`,
        priority: 50,
        created_by: userId,
      },
      { onConflict: "workspace_id,kind,idempotency_key" },
    )
    .select("id")
    .single();
  if (error) throw error;

  revalidatePath("/biblioteca");
  return { jobId: data.id as string };
}

export async function reprocessSource(sourceId: string): Promise<{ jobId: string }> {
  const { supabase } = await requireSession();
  const { data: source, error } = await supabase
    .from("sources")
    .select("current_version_id")
    .eq("id", sourceId)
    .single();
  if (error) throw error;
  if (!source.current_version_id) throw new Error("Este documento não tem arquivo associado.");

  await supabase
    .from("processing_jobs")
    .delete()
    .eq("idempotency_key", `ingest:${source.current_version_id}`);
  return enqueueIngestion(source.current_version_id as string);
}

/**
 * Exclusão completa: arquivo original, versões, seções, resumos, trechos,
 * embeddings, conceitos e afirmações. Nada de dados órfãos.
 */
export async function deleteSource(sourceId: string): Promise<void> {
  const { supabase, workspaceId } = await requireSession();

  const { data: versions } = await supabase
    .from("source_versions")
    .select("storage_bucket, storage_path")
    .eq("source_id", sourceId);

  const paths = (versions ?? [])
    .map((v) => v.storage_path as string | null)
    .filter((p): p is string => Boolean(p));

  if (paths.length) {
    await supabase.storage.from("library-originals").remove(paths);
  }

  // As FKs com ON DELETE CASCADE removem versões, seções, resumos, trechos,
  // embeddings, source_concepts, claims e evidências.
  const { error } = await supabase
    .from("sources")
    .delete()
    .eq("id", sourceId)
    .eq("workspace_id", workspaceId);
  if (error) throw error;

  revalidatePath("/biblioteca");
  revalidatePath("/memoria");
}

export async function updateSourceMetadata(
  sourceId: string,
  input: { title?: string; authorityLevel?: number; category?: string; isActive?: boolean },
): Promise<void> {
  const { supabase } = await requireSession();
  const patch: Record<string, unknown> = {};
  if (input.title) patch.title = input.title;
  if (input.authorityLevel) patch.authority_level = input.authorityLevel;
  if (input.category !== undefined) patch.category = input.category || null;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from("sources").update(patch).eq("id", sourceId);
  if (error) throw error;
  revalidatePath(`/biblioteca/${sourceId}`);
  revalidatePath("/biblioteca");
}

export async function addTagToSource(sourceId: string, name: string): Promise<void> {
  const { supabase, workspaceId, userId } = await requireSession();
  const slug = slugify(name);
  if (!slug) return;

  const { data: tag, error } = await supabase
    .from("tags")
    .upsert(
      { workspace_id: workspaceId, name: name.trim(), slug, created_by: userId },
      { onConflict: "workspace_id,slug" },
    )
    .select("id")
    .single();
  if (error) throw error;

  await supabase.from("source_tags").upsert(
    {
      workspace_id: workspaceId,
      source_id: sourceId,
      tag_id: tag.id,
      created_by: userId,
    },
    { onConflict: "source_id,tag_id" },
  );
  revalidatePath(`/biblioteca/${sourceId}`);
}
