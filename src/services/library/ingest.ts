import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnalystModel } from "@/ai/providers";
import {
  CLAIM_EXTRACTOR,
  CONCEPT_EXTRACTOR,
  SOURCE_SUMMARIZER,
  wrapUntrusted,
} from "@/ai/prompts";
import {
  ClaimExtractionSchema,
  ConceptExtractionSchema,
  SummarySchema,
  type Summary,
} from "@/ai/schemas";
import { recordAudit } from "@/lib/audit";
import { env } from "@/lib/env";
import { slugify } from "@/lib/utils";
import { chunkDocument } from "@/services/ingestion/chunking";
import { extractText } from "@/services/ingestion/extract";
import { detectSections } from "@/services/ingestion/structure";
import { estimateTokens, normalizeText, sha256 } from "@/services/ingestion/text";
import { embedTargets, resolveEmbeddingSpaceId } from "@/services/memory/embeddings";
import { extractiveClaims, extractiveConcepts, extractiveSummary } from "./extractive";

export type IngestionProgress = (progress: number, label: string) => Promise<void> | void;

export type IngestionOutcome = {
  status: "ready" | "ocr_required" | "failed";
  sections: number;
  chunks: number;
  concepts: number;
  claims: number;
  embeddings: number;
  quality: number;
  notes: string | null;
};

/**
 * Pipeline de ingestão de um documento.
 *
 *   UPLOAD → SHA-256 → DEDUPLICAÇÃO → EXTRAÇÃO → NORMALIZAÇÃO → ESTRUTURA
 *   → RESUMO GLOBAL → RESUMOS DE SEÇÃO → CHUNKING → EMBEDDINGS
 *   → CONCEITOS → CLAIMS → READY
 *
 * O arquivo original nunca é substituído. Texto bruto, texto normalizado e
 * estruturas derivadas vivem em colunas e tabelas separadas.
 */
export async function ingestSourceVersion(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string | null;
    sourceVersionId: string;
    onProgress?: IngestionProgress;
  },
): Promise<IngestionOutcome> {
  const report = async (progress: number, label: string) => {
    await input.onProgress?.(progress, label);
  };

  const { data: version, error: versionError } = await supabase
    .from("source_versions")
    .select("*")
    .eq("id", input.sourceVersionId)
    .single();
  if (versionError) throw versionError;

  const { data: source, error: sourceError } = await supabase
    .from("sources")
    .select("*")
    .eq("id", version.source_id)
    .single();
  if (sourceError) throw sourceError;

  await supabase
    .from("source_versions")
    .update({ extraction_status: "extracting" })
    .eq("id", version.id);
  await supabase.from("sources").update({ status: "processing" }).eq("id", source.id);

  // ---- 1. Arquivo original ------------------------------------------------
  await report(5, "Baixando o arquivo original");
  const { data: file, error: downloadError } = await supabase.storage
    .from(version.storage_bucket)
    .download(version.storage_path);
  if (downloadError) throw downloadError;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = sha256(bytes);

  // ---- 2. Deduplicação ----------------------------------------------------
  const { data: duplicate } = await supabase
    .from("source_versions")
    .select("id, source_id")
    .eq("workspace_id", input.workspaceId)
    .eq("sha256", hash)
    .neq("id", version.id)
    .maybeSingle();

  if (duplicate) {
    await supabase
      .from("source_versions")
      .update({
        sha256: null,
        extraction_status: "failed",
        extraction_notes: `Conteúdo idêntico à versão ${duplicate.id}, já presente na biblioteca.`,
        status: "failed",
      })
      .eq("id", version.id);
    await supabase
      .from("sources")
      .update({ status: "failed", description: "Documento duplicado." })
      .eq("id", source.id);
    return {
      status: "failed",
      sections: 0,
      chunks: 0,
      concepts: 0,
      claims: 0,
      embeddings: 0,
      quality: 0,
      notes: "Documento duplicado: já existe na biblioteca com o mesmo conteúdo.",
    };
  }

  // ---- 3. Extração --------------------------------------------------------
  await report(15, "Extraindo o texto");
  const extraction = await extractText({
    file: bytes,
    filename: version.original_filename ?? "documento",
    mimeType: version.mime_type ?? "application/octet-stream",
  });

  const normalized = normalizeText(extraction.rawText);

  await supabase
    .from("source_versions")
    .update({
      sha256: hash,
      byte_size: bytes.byteLength,
      raw_text: extraction.rawText,
      normalized_text: normalized,
      extraction_status: extraction.status,
      extraction_engine: extraction.engine,
      extraction_quality: extraction.quality,
      extraction_notes: extraction.notes,
      page_count: extraction.pageCount,
      char_count: normalized.length,
      word_count: normalized.split(/\s+/).filter(Boolean).length,
    })
    .eq("id", version.id);

  if (extraction.status === "ocr_required" || extraction.status === "failed") {
    // Princípio: não introduzir texto ruim na memória.
    await supabase
      .from("sources")
      .update({ status: extraction.status === "failed" ? "failed" : "ocr_required" })
      .eq("id", source.id);
    return {
      status: extraction.status === "failed" ? "failed" : "ocr_required",
      sections: 0,
      chunks: 0,
      concepts: 0,
      claims: 0,
      embeddings: 0,
      quality: extraction.quality,
      notes: extraction.notes,
    };
  }

  // ---- 4. Estrutura -------------------------------------------------------
  await report(25, "Identificando capítulos e seções");
  const { status: structureStatus, sections } = detectSections(normalized, extraction.pageOffsets);

  await supabase.from("source_sections").delete().eq("source_version_id", version.id);

  const sectionIdBySequence = new Map<number, string>();
  for (const section of sections) {
    const { data: inserted, error } = await supabase
      .from("source_sections")
      .insert({
        workspace_id: input.workspaceId,
        source_id: source.id,
        source_version_id: version.id,
        parent_section_id:
          section.parentSequence !== null
            ? (sectionIdBySequence.get(section.parentSequence) ?? null)
            : null,
        level: section.level,
        sequence: section.sequence,
        title: section.title,
        heading_path: section.headingPath,
        char_start: section.charStart,
        char_end: section.charEnd,
        page_start: section.pageStart,
        page_end: section.pageEnd,
        token_count: section.tokenCount,
        created_by: input.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    sectionIdBySequence.set(section.sequence, inserted.id as string);
  }

  await supabase
    .from("source_versions")
    .update({ structure_status: structureStatus })
    .eq("id", version.id);

  // ---- 5. Chunking --------------------------------------------------------
  await report(40, "Dividindo o texto em trechos");
  const e = env();
  const chunks = chunkDocument(normalized, sections, {
    targetTokens: e.CHUNK_TARGET_TOKENS,
    overlapTokens: e.CHUNK_OVERLAP_TOKENS,
    pageOffsets: extraction.pageOffsets,
  });

  await supabase.from("source_chunks").delete().eq("source_version_id", version.id);

  const chunkRows = chunks.map((chunk) => ({
    workspace_id: input.workspaceId,
    source_id: source.id,
    source_version_id: version.id,
    section_id:
      chunk.sectionSequence !== null
        ? (sectionIdBySequence.get(chunk.sectionSequence) ?? null)
        : null,
    sequence: chunk.sequence,
    text: chunk.text,
    heading_path: chunk.headingPath,
    char_start: chunk.charStart,
    char_end: chunk.charEnd,
    page_start: chunk.pageStart,
    page_end: chunk.pageEnd,
    token_count: chunk.tokenCount,
    hash: sha256(chunk.text),
    created_by: input.userId,
  }));

  const insertedChunks: Array<{ id: string; sequence: number; text: string }> = [];
  for (let i = 0; i < chunkRows.length; i += 100) {
    const { data, error } = await supabase
      .from("source_chunks")
      .insert(chunkRows.slice(i, i + 100))
      .select("id, sequence, text");
    if (error) throw error;
    insertedChunks.push(...(data as typeof insertedChunks));
  }
  insertedChunks.sort((a, b) => a.sequence - b.sequence);

  // ---- 6. Resumos ---------------------------------------------------------
  await report(55, "Resumindo o documento e as seções");
  await supabase.from("source_summaries").delete().eq("source_version_id", version.id);

  const globalSummary = await summarize(
    supabase,
    input.workspaceId,
    `${source.title}\n\n${normalized}`,
    "documento inteiro",
  );

  const { data: globalSummaryRow, error: globalSummaryError } = await supabase
    .from("source_summaries")
    .insert({
      workspace_id: input.workspaceId,
      source_id: source.id,
      source_version_id: version.id,
      scope: "global",
      summary: globalSummary.summary,
      key_points: globalSummary.key_points,
      themes: globalSummary.themes,
      model: globalSummary.model,
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (globalSummaryError) throw globalSummaryError;

  const sectionSummaries: Array<{ id: string; text: string }> = [];
  const summarizableSections = sections.filter(
    (s) => s.charEnd - s.charStart > 500 && sections.length > 1,
  );

  for (const section of summarizableSections.slice(0, 60)) {
    const sectionText = normalized.slice(section.charStart, section.charEnd);
    const summary = await summarize(
      supabase,
      input.workspaceId,
      `${section.title}\n\n${sectionText}`,
      `seção "${section.title}"`,
      3,
    );
    const { data, error } = await supabase
      .from("source_summaries")
      .insert({
        workspace_id: input.workspaceId,
        source_id: source.id,
        source_version_id: version.id,
        section_id: sectionIdBySequence.get(section.sequence),
        scope: "section",
        summary: summary.summary,
        key_points: summary.key_points,
        themes: summary.themes,
        model: summary.model,
        created_by: input.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    sectionSummaries.push({ id: data.id as string, text: summary.summary });
  }

  // ---- 7. Embeddings ------------------------------------------------------
  await report(70, "Gerando os vetores de busca");
  const spaceId = await resolveEmbeddingSpaceId(supabase);

  const { inserted: embeddingCount } = await embedTargets(supabase, {
    workspaceId: input.workspaceId,
    embeddingSpaceId: spaceId,
    targets: [
      {
        ownerKind: "source_summary",
        ownerId: globalSummaryRow.id as string,
        sourceId: source.id,
        text: `${source.title}. ${globalSummary.summary} ${globalSummary.themes.join(", ")}`,
      },
      ...sectionSummaries.map((s) => ({
        ownerKind: "section_summary" as const,
        ownerId: s.id,
        sourceId: source.id as string,
        text: s.text,
      })),
      ...insertedChunks.map((c) => ({
        ownerKind: "chunk" as const,
        ownerId: c.id,
        sourceId: source.id as string,
        text: c.text,
      })),
    ],
  });

  // ---- 8. Conceitos -------------------------------------------------------
  await report(85, "Extraindo conceitos");
  const conceptCount = await extractConcepts(supabase, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    sourceId: source.id,
    text: normalized,
  });

  // ---- 9. Afirmações ------------------------------------------------------
  await report(92, "Extraindo afirmações rastreáveis");
  const claimCount = await extractClaims(supabase, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    sourceId: source.id,
    sourceVersionId: version.id,
    authorityLevel: source.authority_level as number,
    chunks: insertedChunks,
    embeddingSpaceId: spaceId,
  });

  // ---- 10. Pronto ---------------------------------------------------------
  await supabase
    .from("sources")
    .update({ status: "ready", current_version_id: version.id })
    .eq("id", source.id);
  await supabase
    .from("source_versions")
    .update({ extraction_status: extraction.status, status: "active" })
    .eq("id", version.id);
  await report(100, "Documento disponível na memória");

  return {
    status: "ready",
    sections: sections.length,
    chunks: insertedChunks.length,
    concepts: conceptCount,
    claims: claimCount,
    embeddings: embeddingCount,
    quality: extraction.quality,
    notes: extraction.notes,
  };
}

// --------------------------------------------------------------------------

async function summarize(
  supabase: SupabaseClient,
  workspaceId: string,
  text: string,
  label: string,
  maxSentences = 5,
): Promise<Summary & { model: string }> {
  const model = getAnalystModel();
  const excerpt = text.slice(0, 60_000);

  const { value, usage } = await model.generateStructured({
    promptName: SOURCE_SUMMARIZER.name,
    promptVersion: SOURCE_SUMMARIZER.version,
    system: SOURCE_SUMMARIZER.system,
    user: wrapUntrusted(`Resuma o seguinte material (${label})`, excerpt),
    schema: SummarySchema,
    schemaName: SOURCE_SUMMARIZER.schemaName!,
    maxOutputTokens: 1200,
    demoFallback: () => extractiveSummary(excerpt, maxSentences),
  });

  await recordAudit(supabase, {
    workspaceId,
    action: "summarize",
    entityKind: "source_summary",
    usage,
    actorKind: "ai",
  });

  return { ...value, model: usage.demo ? "extractive-demo" : usage.model };
}

async function extractConcepts(
  supabase: SupabaseClient,
  input: { workspaceId: string; userId: string | null; sourceId: string; text: string },
): Promise<number> {
  const model = getAnalystModel();
  const excerpt = input.text.slice(0, 40_000);

  const { value, usage } = await model.generateStructured({
    promptName: CONCEPT_EXTRACTOR.name,
    promptVersion: CONCEPT_EXTRACTOR.version,
    system: CONCEPT_EXTRACTOR.system,
    user: wrapUntrusted("Extraia os conceitos do texto a seguir", excerpt),
    schema: ConceptExtractionSchema,
    schemaName: CONCEPT_EXTRACTOR.schemaName!,
    maxOutputTokens: 2000,
    demoFallback: () => extractiveConcepts(excerpt),
  });

  await recordAudit(supabase, {
    workspaceId: input.workspaceId,
    action: "extract_concepts",
    entityKind: "source",
    entityId: input.sourceId,
    usage,
    actorKind: "ai",
  });

  let count = 0;
  for (const concept of value.concepts) {
    const slug = slugify(concept.label);
    if (!slug) continue;

    const { data: existing } = await supabase
      .from("concepts")
      .select("id, occurrences")
      .eq("workspace_id", input.workspaceId)
      .eq("slug", slug)
      .maybeSingle();

    let conceptId: string;
    if (existing) {
      conceptId = existing.id as string;
      await supabase
        .from("concepts")
        .update({ occurrences: (existing.occurrences as number) + 1 })
        .eq("id", conceptId);
    } else {
      const { data: created, error } = await supabase
        .from("concepts")
        .insert({
          workspace_id: input.workspaceId,
          label: concept.label,
          slug,
          definition: concept.definition,
          aliases: concept.aliases,
          occurrences: 1,
          // Inferência da IA nasce como candidata — nunca como verdade.
          status: "candidate",
          confidence: concept.confidence,
          created_by: input.userId,
        })
        .select("id")
        .single();
      if (error) throw error;
      conceptId = created.id as string;
    }

    await supabase.from("source_concepts").upsert(
      {
        workspace_id: input.workspaceId,
        source_id: input.sourceId,
        concept_id: conceptId,
        weight: concept.confidence,
        created_by: input.userId,
      },
      { onConflict: "source_id,concept_id" },
    );
    count += 1;
  }

  return count;
}

async function extractClaims(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string | null;
    sourceId: string;
    sourceVersionId: string;
    authorityLevel: number;
    chunks: Array<{ id: string; text: string; sequence: number }>;
    embeddingSpaceId: string;
  },
): Promise<number> {
  const model = getAnalystModel();
  // Amostragem: os trechos mais substantivos, para não estourar custo em livros
  // longos. O restante continua pesquisável por embedding e por texto.
  const candidates = [...input.chunks]
    .sort((a, b) => estimateTokens(b.text) - estimateTokens(a.text))
    .slice(0, 40)
    .sort((a, b) => a.sequence - b.sequence);

  const created: Array<{ id: string; text: string }> = [];

  for (const chunk of candidates) {
    const { value, usage } = await model.generateStructured({
      promptName: CLAIM_EXTRACTOR.name,
      promptVersion: CLAIM_EXTRACTOR.version,
      system: CLAIM_EXTRACTOR.system,
      user: wrapUntrusted("Extraia as afirmações rastreáveis deste trecho", chunk.text),
      schema: ClaimExtractionSchema,
      schemaName: CLAIM_EXTRACTOR.schemaName!,
      maxOutputTokens: 1500,
      demoFallback: () => extractiveClaims(chunk.text),
    });

    for (const claim of value.claims) {
      // Rastreabilidade obrigatória: a citação precisa existir no trecho.
      const quoteIndex = chunk.text.indexOf(claim.quote.trim());
      if (claim.quote.trim().length < 15 || quoteIndex < 0) continue;

      const { data: claimRow, error } = await supabase
        .from("claims")
        .insert({
          workspace_id: input.workspaceId,
          source_id: input.sourceId,
          source_version_id: input.sourceVersionId,
          text: claim.text,
          kind: claim.kind,
          polarity: claim.polarity,
          confidence: claim.confidence,
          authority_level: input.authorityLevel,
          status: "candidate",
          requires_review: claim.confidence < 0.5,
          model: usage.demo ? "extractive-demo" : usage.model,
          created_by: input.userId,
        })
        .select("id")
        .single();
      if (error) throw error;

      await supabase.from("claim_evidence").insert({
        workspace_id: input.workspaceId,
        claim_id: claimRow.id,
        chunk_id: chunk.id,
        source_id: input.sourceId,
        quote: claim.quote.trim(),
        char_start: quoteIndex,
        char_end: quoteIndex + claim.quote.trim().length,
        strength: claim.confidence,
        created_by: input.userId,
      });

      created.push({ id: claimRow.id as string, text: claim.text });
    }
  }

  if (created.length > 0) {
    await embedTargets(supabase, {
      workspaceId: input.workspaceId,
      embeddingSpaceId: input.embeddingSpaceId,
      targets: created.map((c) => ({
        ownerKind: "claim" as const,
        ownerId: c.id,
        sourceId: input.sourceId,
        text: c.text,
      })),
    });
  }

  return created.length;
}
