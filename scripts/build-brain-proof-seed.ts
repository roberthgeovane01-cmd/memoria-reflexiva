/**
 * PROVA DO CÉREBRO — gerador do conjunto de documentos fictícios.
 *
 * Roda o pipeline REAL (normalização, detecção de estrutura, chunking,
 * resumo extrativo e o hashing vectorizer do modo demonstração) sobre quatro
 * livros inventados e emite o SQL de seed. Não há atalho: os trechos, os
 * resumos e os vetores gravados são os mesmos que a ingestão produziria.
 *
 *   npx tsx scripts/build-brain-proof-seed.ts > supabase/seed/brain-proof.sql
 */
import { hashingEmbedding } from "../src/ai/providers/mock";
import { chunkDocument } from "../src/services/ingestion/chunking";
import { detectSections } from "../src/services/ingestion/structure";
import { normalizeText, sha256 } from "../src/services/ingestion/text";
import { extractiveSummary } from "../src/services/library/extractive";
import { CORPUS, DEMO_USER_ID, DEMO_WORKSPACE_ID } from "./brain-proof-corpus";

const DIMS = 1536;

function esc(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sparse(text: string): string {
  const vector = hashingEmbedding(text, DIMS);
  const idx: number[] = [];
  const val: number[] = [];
  vector.forEach((v, i) => {
    // Poda componentes irrelevantes: reduz o tamanho do seed sem alterar de
    // forma perceptível a similaridade de cosseno.
    if (Math.abs(v) >= 0.06) {
      idx.push(i);
      val.push(Number(v.toFixed(3)));
    }
  });
  return `public.mr_vector_from_sparse(${DIMS}, ARRAY[${idx.join(",")}]::int[], ARRAY[${val.join(",")}]::float8[])`;
}

const out: string[] = [];
out.push("-- Gerado por scripts/build-brain-proof-seed.ts — não editar à mão.");
out.push(`delete from public.sources where workspace_id = '${DEMO_WORKSPACE_ID}'
  and metadata->>'demo' = 'brain-proof';`);

for (const book of CORPUS) {
  const normalized = normalizeText(book.text);
  const { sections } = detectSections(normalized);
  const chunks = chunkDocument(normalized, sections, {
    targetTokens: 90,
    overlapTokens: 15,
    minTokens: 15,
  });
  const globalSummary = extractiveSummary(normalized, 3);

  out.push(`
-- ====== ${book.title} ======
insert into public.sources
  (id, workspace_id, title, authors, kind, category, authority_level, status,
   is_active, origin, metadata, created_by)
values ('${book.sourceId}', '${DEMO_WORKSPACE_ID}', ${esc(book.title)},
        ARRAY[${book.authors.map(esc).join(",")}]::text[], 'book', ${esc(book.category)},
        ${book.authority}, 'ready', true, 'upload',
        '{"demo":"brain-proof"}'::jsonb, '${DEMO_USER_ID}');

insert into public.source_versions
  (id, workspace_id, source_id, version_number, storage_path, original_filename,
   mime_type, sha256, extraction_status, extraction_engine, extraction_quality,
   char_count, raw_text, normalized_text, structure_status, created_by)
values ('${book.versionId}', '${DEMO_WORKSPACE_ID}', '${book.sourceId}', 1, null,
        ${esc(`${book.title}.md`)}, 'text/markdown', ${esc(sha256(normalized))},
        'extracted', 'markdown', 1.0, ${normalized.length},
        ${esc(book.text)}, ${esc(normalized)}, 'detected', '${DEMO_USER_ID}');

update public.sources set current_version_id = '${book.versionId}' where id = '${book.sourceId}';`);

  const sectionIds: string[] = [];
  sections.forEach((section, index) => {
    const id = `${book.sectionPrefix}${String(index).padStart(12, "0")}`;
    sectionIds.push(id);
    const parent =
      section.parentSequence !== null ? `'${sectionIds[section.parentSequence]}'` : "null";
    out.push(`insert into public.source_sections
  (id, workspace_id, source_id, source_version_id, parent_section_id, level, sequence,
   title, heading_path, char_start, char_end, token_count, created_by)
values ('${id}', '${DEMO_WORKSPACE_ID}', '${book.sourceId}', '${book.versionId}', ${parent},
        ${section.level}, ${section.sequence}, ${esc(section.title)},
        ARRAY[${section.headingPath.map(esc).join(",")}]::text[],
        ${section.charStart}, ${section.charEnd}, ${section.tokenCount}, '${DEMO_USER_ID}');`);
  });

  const globalSummaryId = `${book.sectionPrefix}999999999999`;
  out.push(`insert into public.source_summaries
  (id, workspace_id, source_id, source_version_id, scope, summary, key_points, themes,
   model, created_by)
values ('${globalSummaryId}', '${DEMO_WORKSPACE_ID}', '${book.sourceId}', '${book.versionId}',
        'global', ${esc(globalSummary.summary)},
        ARRAY[${globalSummary.key_points.map(esc).join(",")}]::text[],
        ARRAY[${globalSummary.themes.map(esc).join(",")}]::text[],
        'extractive-demo', '${DEMO_USER_ID}');

insert into public.embeddings
  (workspace_id, embedding_space_id, owner_kind, owner_id, source_id, embedding)
select '${DEMO_WORKSPACE_ID}', id, 'source_summary', '${globalSummaryId}', '${book.sourceId}',
       ${sparse(`${book.title}. ${globalSummary.summary} ${globalSummary.themes.join(", ")}`)}
from public.embedding_spaces where provider = 'mock' and model = 'deterministic-hash-1536' limit 1;`);

  // Resumo por seção (as seções com corpo relevante).
  sections.forEach((section, index) => {
    const body = normalized.slice(section.charStart, section.charEnd);
    if (body.length < 200) return;
    const summary = extractiveSummary(body, 2);
    const id = `${book.sectionPrefix}8${String(index).padStart(11, "0")}`;
    out.push(`insert into public.source_summaries
  (id, workspace_id, source_id, source_version_id, section_id, scope, summary,
   key_points, themes, model, created_by)
values ('${id}', '${DEMO_WORKSPACE_ID}', '${book.sourceId}', '${book.versionId}',
        '${sectionIds[index]}', 'section', ${esc(summary.summary)},
        ARRAY[${summary.key_points.map(esc).join(",")}]::text[],
        ARRAY[${summary.themes.map(esc).join(",")}]::text[],
        'extractive-demo', '${DEMO_USER_ID}');

insert into public.embeddings
  (workspace_id, embedding_space_id, owner_kind, owner_id, source_id, embedding)
select '${DEMO_WORKSPACE_ID}', id, 'section_summary', '${id}', '${book.sourceId}',
       ${sparse(summary.summary)}
from public.embedding_spaces where provider = 'mock' and model = 'deterministic-hash-1536' limit 1;`);
  });

  chunks.forEach((chunk, index) => {
    const id = `${book.chunkPrefix}${String(index).padStart(12, "0")}`;
    const sectionId =
      chunk.sectionSequence !== null ? `'${sectionIds[chunk.sectionSequence]}'` : "null";
    out.push(`insert into public.source_chunks
  (id, workspace_id, source_id, source_version_id, section_id, sequence, text,
   heading_path, char_start, char_end, token_count, hash, created_by)
values ('${id}', '${DEMO_WORKSPACE_ID}', '${book.sourceId}', '${book.versionId}', ${sectionId},
        ${chunk.sequence}, ${esc(chunk.text)},
        ARRAY[${chunk.headingPath.map(esc).join(",")}]::text[],
        ${chunk.charStart}, ${chunk.charEnd}, ${chunk.tokenCount},
        ${esc(sha256(chunk.text))}, '${DEMO_USER_ID}');

insert into public.embeddings
  (workspace_id, embedding_space_id, owner_kind, owner_id, source_id, embedding)
select '${DEMO_WORKSPACE_ID}', id, 'chunk', '${id}', '${book.sourceId}',
       ${sparse(chunk.text)}
from public.embedding_spaces where provider = 'mock' and model = 'deterministic-hash-1536' limit 1;`);
  });
}

process.stdout.write(out.join("\n") + "\n");
