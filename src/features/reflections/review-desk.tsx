"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Download,
  FileSearch,
  Mic,
  PenLine,
  Search,
  Volume2,
} from "lucide-react";
import {
  Alert,
  AuthorityMeter,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Muted,
  Select,
  Textarea,
} from "@/components/ui";
import { formatDateTime, formatDuration, truncate } from "@/lib/utils";
import {
  approveReflectionVersion,
  approveTranscript,
  generateReflection,
  generateVoice,
  investigate,
  publishReflectionToMemory,
  resolveConflict,
  saveReflectionEdit,
  saveTranscript,
} from "./actions";
import {
  CLASSIFICATION_LABELS,
  CONFLICT_KIND_LABELS,
  SESSION_STATUS_LABELS,
  sessionStatusTone,
} from "./status";

/* ========================================================================== */

export type DeskData = {
  session: {
    id: string;
    status: string;
    statusReason: string | null;
    centralQuestion: string | null;
    createdAt: string;
    hasRetrieval: boolean;
  };
  audio: {
    id: string;
    url: string | null;
    durationSeconds: number | null;
    filename: string | null;
    kind: string;
  } | null;
  transcript: {
    id: string;
    raw: string;
    approved: string;
    status: string;
    provider: string | null;
    confidence: number | null;
  } | null;
  dossier: {
    id: string;
    central_question: string;
    executive_summary: string;
    has_memory: boolean;
    convergences: Finding[];
    complements: Finding[];
    tensions: Finding[];
    contradictions: Finding[];
    knowledge_gaps: string[];
    central_sources: Array<{ source_id: string; why: string }>;
    editorial_notes: string[];
    coverage_score: number | null;
    diversity_score: number | null;
    model: string | null;
  } | null;
  evidence: Array<{
    id: string;
    owner_kind: string;
    source_id: string | null;
    snippet: string | null;
    authority_level: number | null;
    final_score: number | null;
    fusion_score: number | null;
    rerank_score: number | null;
    vector_score: number | null;
    fulltext_score: number | null;
    explanation: Record<string, unknown> | null;
    sources: { title: string; authors: string[] | null } | null;
    source_sections: { title: string | null } | null;
  }>;
  conflicts: Array<{
    id: string;
    kind: string;
    severity: string;
    blocking: boolean;
    title: string;
    description: string;
    speech_excerpt: string | null;
    memory_excerpt: string | null;
    status: string;
    confidence: number | null;
    conflict_resolutions: Array<{
      decision: string;
      manual_text: string | null;
      rationale: string | null;
      decided_at: string;
    }> | null;
  }>;
  reflection: {
    id: string;
    title: string | null;
    status: string;
    currentVersionId: string | null;
    approvedVersionId: string | null;
  } | null;
  versions: Array<{
    id: string;
    version_number: number;
    text: string;
    status: string;
    origin: string;
    model: string | null;
    word_count: number | null;
    diff_summary: string | null;
    created_at: string;
    approved_at: string | null;
  }>;
  narration: { url: string | null; status: string | null };
};

type Finding = {
  statement: string;
  detail: string;
  evidence_ids: string[];
  source_ids?: string[];
};

const DECISIONS = [
  { value: "keep_speech", label: "Manter a minha fala como está" },
  { value: "use_memory", label: "Usar o que a memória registra" },
  { value: "treat_as_complement", label: "Tratar como complemento" },
  { value: "treat_as_evolution", label: "Entender como evolução da minha posição" },
  { value: "manual_edit", label: "Escrever eu mesmo como deve ficar" },
  { value: "ignore_source", label: "Ignorar esta fonte neste contexto" },
];

/**
 * MESA DE REVISÃO — a tela mais importante.
 *
 * Quatro áreas, sempre distinguíveis: a fala atual, a memória recuperada, os
 * conflitos e a reflexão. A interface nunca mistura o que a pessoa disse, o
 * que foi recuperado, o que a IA concluiu e o que a IA escreveu.
 */
export function ReviewDesk({ data }: { data: DeskData }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-[1600px]">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={sessionStatusTone(data.session.status)}>
            {SESSION_STATUS_LABELS[data.session.status] ?? data.session.status}
          </Badge>
          <Muted className="text-xs">{formatDateTime(data.session.createdAt)}</Muted>
          {data.session.hasRetrieval ? (
            <Link
              href={`/historico/${data.session.id}`}
              className="text-accent inline-flex items-center gap-1 text-xs underline underline-offset-2"
            >
              <FileSearch size={12} aria-hidden />
              Como a memória chegou aqui?
            </Link>
          ) : null}
        </div>
        <h1 className="mt-3 max-w-3xl font-serif text-[26px] leading-snug tracking-tight">
          {data.session.centralQuestion ?? "Sessão em aberto"}
        </h1>
        {data.session.statusReason ? (
          <p className="text-danger mt-2 text-sm">{data.session.statusReason}</p>
        ) : null}
      </header>

      {error ? (
        <div className="mb-5">
          <Alert tone="danger" title="Algo deu errado">
            {error}
          </Alert>
        </div>
      ) : null}
      {message ? (
        <div className="mb-5">
          <Alert tone="success">{message}</Alert>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2 2xl:grid-cols-4">
        <SpeechPanel data={data} onError={setError} onMessage={setMessage} />
        <MemoryPanel data={data} onError={setError} onMessage={setMessage} />
        <ConflictsPanel data={data} onError={setError} onMessage={setMessage} />
        <ReflectionPanel data={data} onError={setError} onMessage={setMessage} />
      </div>
    </div>
  );
}

type PanelProps = {
  data: DeskData;
  onError: (value: string | null) => void;
  onMessage: (value: string | null) => void;
};

/* ---------------------------------------------------------------- 1. FALA */

function SpeechPanel({ data, onError, onMessage }: PanelProps) {
  const router = useRouter();
  const [text, setText] = useState(data.transcript?.approved ?? "");
  const [pending, startTransition] = useTransition();
  const [showRaw, setShowRaw] = useState(false);

  const approved = data.transcript?.status === "approved";
  const dirty = text !== (data.transcript?.approved ?? "");

  function handleSave() {
    if (!data.transcript) return;
    onError(null);
    startTransition(async () => {
      const result = await saveTranscript(data.transcript!.id, text);
      if (!result.ok) onError(result.error);
      else {
        onMessage("Transcrição salva.");
        router.refresh();
      }
    });
  }

  function handleApprove() {
    if (!data.transcript) return;
    onError(null);
    startTransition(async () => {
      const saved = await saveTranscript(data.transcript!.id, text);
      if (!saved.ok) {
        onError(saved.error);
        return;
      }
      const result = await approveTranscript(data.transcript!.id, data.session.id);
      if (!result.ok) onError(result.error);
      else {
        onMessage("Transcrição aprovada. O relato entrou na memória episódica.");
        router.refresh();
      }
    });
  }

  return (
    <Panel
      tone="speech"
      icon={<Mic size={15} aria-hidden />}
      title="Sua fala"
      subtitle="O que você disse, revisado por você."
    >
      {data.audio?.url ? (
        <div className="mb-4">
          <audio src={data.audio.url} controls className="w-full" />
          <Muted className="mt-1.5 text-xs">
            {data.audio.filename ?? "gravação"}
            {data.audio.durationSeconds ? ` · ${formatDuration(data.audio.durationSeconds)}` : ""} ·
            o arquivo original fica preservado
          </Muted>
        </div>
      ) : null}

      {!data.transcript ? (
        <EmptyState
          title="Sem transcrição ainda"
          description="Assim que o áudio for transcrito, o texto aparece aqui para a sua revisão."
        />
      ) : (
        <>
          {data.transcript.provider === "mock" ? (
            <div className="mb-3">
              <Alert tone="inference">
                Transcrição automática desligada. Escreva ou cole abaixo o que você disse.
              </Alert>
            </div>
          ) : null}

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            disabled={approved}
            aria-label="Transcrição para revisão"
            className="font-serif text-[15px] leading-relaxed"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {approved ? (
              <Badge tone="success">
                <Check size={11} aria-hidden /> aprovada por você
              </Badge>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSave}
                  disabled={pending || !dirty}
                >
                  Salvar rascunho
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApprove}
                  disabled={pending || text.trim().length < 20}
                >
                  {pending ? "Aprovando…" : "Aprovar transcrição"}
                </Button>
              </>
            )}
          </div>

          {data.transcript.raw && data.transcript.raw !== data.transcript.approved ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                className="text-ink-faint text-xs underline underline-offset-2"
              >
                {showRaw ? "Esconder" : "Ver"} a transcrição bruta original
              </button>
              {showRaw ? (
                <p className="bg-surface-2 text-ink-faint mt-2 rounded-[var(--radius)] p-3 text-xs leading-relaxed">
                  {data.transcript.raw}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------- 2. MEMÓRIA */

function MemoryPanel({ data, onError, onMessage }: PanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);

  const canInvestigate = data.transcript?.status === "approved";

  function handleInvestigate() {
    onError(null);
    onMessage("Investigando a biblioteca. Isso pode levar um minuto.");
    startTransition(async () => {
      const result = await investigate(data.session.id);
      if (!result.ok) {
        onError(result.error);
        onMessage(null);
      } else {
        onMessage(
          result.data.blocking
            ? "Investigação concluída — há um conflito factual esperando a sua decisão."
            : `Investigação concluída com ${result.data.evidence} evidência(s).`,
        );
        router.refresh();
      }
    });
  }

  return (
    <Panel
      tone="memory"
      icon={<BookOpen size={15} aria-hidden />}
      title="Memória"
      subtitle="O que foi recuperado da sua biblioteca — com origem."
    >
      {!data.dossier ? (
        <div className="space-y-4">
          <EmptyState
            title="A memória ainda não foi investigada"
            description="Aprove a transcrição e o sistema vai procurar em todos os livros ativos, descer aos capítulos e trazer as evidências concretas."
          />
          <Button
            variant="primary"
            onClick={handleInvestigate}
            disabled={!canInvestigate || pending}
            className="w-full"
          >
            <Search size={16} aria-hidden />
            {pending ? "Investigando…" : "Investigar a memória"}
          </Button>
          {!canInvestigate ? (
            <Muted className="text-center text-xs">
              A investigação começa depois que você aprova a transcrição.
            </Muted>
          ) : null}
        </div>
      ) : (
        <div className="space-y-5">
          {!data.dossier.has_memory ? (
            <Alert tone="inference" title="Sem memória sobre este assunto">
              {data.dossier.executive_summary}
            </Alert>
          ) : (
            <section>
              <SectionLabel>Síntese do dossiê</SectionLabel>
              <p className="text-ink-soft text-sm leading-relaxed">
                {data.dossier.executive_summary}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.dossier.coverage_score != null ? (
                  <Badge>cobertura {(data.dossier.coverage_score * 100).toFixed(0)}%</Badge>
                ) : null}
                {data.dossier.diversity_score != null ? (
                  <Badge>diversidade {(data.dossier.diversity_score * 100).toFixed(0)}%</Badge>
                ) : null}
                {data.dossier.model ? <Badge tone="inference">{data.dossier.model}</Badge> : null}
              </div>
            </section>
          )}

          <FindingGroup label="Convergências" items={data.dossier.convergences} tone="success" />
          <FindingGroup label="Complementos" items={data.dossier.complements} tone="memory" />
          <FindingGroup label="Tensões" items={data.dossier.tensions} tone="inference" />
          <FindingGroup label="Contradições" items={data.dossier.contradictions} tone="danger" />

          {data.dossier.knowledge_gaps.length ? (
            <section>
              <SectionLabel>O que a biblioteca não cobre</SectionLabel>
              <ul className="text-ink-soft list-inside list-disc space-y-1 text-sm">
                {data.dossier.knowledge_gaps.map((gap, i) => (
                  <li key={i}>{gap}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <SectionLabel>Evidências utilizadas ({data.evidence.length})</SectionLabel>
            <ul className="space-y-2">
              {data.evidence.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setOpenEvidence(openEvidence === item.id ? null : item.id)}
                    aria-expanded={openEvidence === item.id}
                    className="border-line bg-surface-2/60 hover:bg-surface-2 w-full rounded-[var(--radius)] border px-3 py-2.5 text-left transition-colors"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="text-ink block truncate text-[13px] font-medium">
                          {item.sources?.title ?? ownerKindLabel(item.owner_kind)}
                        </span>
                        {item.source_sections?.title ? (
                          <span className="text-ink-faint block truncate text-xs">
                            {item.source_sections.title}
                          </span>
                        ) : null}
                      </span>
                      <AuthorityMeter level={item.authority_level ?? 3} />
                    </span>
                    <span className="text-ink-soft mt-1.5 block text-xs leading-relaxed">
                      {openEvidence === item.id ? item.snippet : truncate(item.snippet ?? "", 140)}
                    </span>
                    {openEvidence === item.id ? (
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone="neutral">vetorial {(item.vector_score ?? 0).toFixed(3)}</Badge>
                        <Badge tone="neutral">
                          textual {(item.fulltext_score ?? 0).toFixed(3)}
                        </Badge>
                        <Badge tone="neutral">fusão {(item.fusion_score ?? 0).toFixed(4)}</Badge>
                        <Badge tone="neutral">
                          reranking {(item.rerank_score ?? 0).toFixed(3)}
                        </Badge>
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <Button variant="ghost" size="sm" onClick={handleInvestigate} disabled={pending}>
            <Search size={14} aria-hidden /> Investigar de novo
          </Button>
        </div>
      )}
    </Panel>
  );
}

function FindingGroup({
  label,
  items,
  tone,
}: {
  label: string;
  items: Finding[];
  tone: "success" | "memory" | "inference" | "danger";
}) {
  if (!items?.length) return null;
  return (
    <section>
      <SectionLabel>{label}</SectionLabel>
      <ul className="space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="border-l-2 pl-3" style={{ borderColor: "var(--line-strong)" }}>
            <p className="text-ink text-sm">{item.statement}</p>
            <p className="text-ink-faint mt-0.5 text-xs">{item.detail}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Badge tone={tone}>{item.evidence_ids.length} evidência(s)</Badge>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ----------------------------------------------------------- 3. CONFLITOS */

function ConflictsPanel({ data, onError, onMessage }: PanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, { decision: string; manualText: string }>>(
    {},
  );

  function decide(conflictId: string) {
    const draft = drafts[conflictId] ?? { decision: "keep_speech", manualText: "" };
    onError(null);
    startTransition(async () => {
      const result = await resolveConflict({
        conflictId,
        sessionId: data.session.id,
        decision: draft.decision as "keep_speech",
        manualText: draft.manualText || null,
      });
      if (!result.ok) onError(result.error);
      else {
        onMessage("Decisão registrada.");
        router.refresh();
      }
    });
  }

  const open = data.conflicts.filter((c) => !c.conflict_resolutions?.length);
  const resolved = data.conflicts.filter((c) => c.conflict_resolutions?.length);

  return (
    <Panel
      tone="inference"
      icon={<AlertTriangle size={15} aria-hidden />}
      title="Conflitos"
      subtitle="Divergências encontradas. Quem decide é você."
    >
      {data.conflicts.length === 0 ? (
        <EmptyState
          title={data.dossier ? "Nenhuma divergência encontrada" : "Nada a decidir ainda"}
          description={
            data.dossier
              ? "A fala e a memória não se contradizem no que foi recuperado."
              : "Os conflitos aparecem depois que a memória é investigada."
          }
        />
      ) : (
        <div className="space-y-4">
          {open.map((conflict) => {
            const draft = drafts[conflict.id] ?? { decision: "keep_speech", manualText: "" };
            return (
              <article
                key={conflict.id}
                className="border-line bg-surface-2/50 rounded-[var(--radius)] border p-4"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone={conflict.severity === "high" ? "danger" : "inference"}>
                    {CONFLICT_KIND_LABELS[conflict.kind] ?? conflict.kind}
                  </Badge>
                  <Badge>{conflict.severity}</Badge>
                  {conflict.blocking ? <Badge tone="danger">bloqueia a escrita</Badge> : null}
                </div>

                <h3 className="text-ink font-serif text-[15px] leading-snug">{conflict.title}</h3>
                <p className="text-ink-soft mt-1.5 text-sm leading-relaxed">
                  {conflict.description}
                </p>

                {conflict.speech_excerpt || conflict.memory_excerpt ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {conflict.speech_excerpt ? (
                      <div className="border-speech/25 bg-speech-soft rounded border p-2.5">
                        <p className="text-speech mb-1 text-[10px] font-semibold tracking-wide uppercase">
                          sua fala
                        </p>
                        <p className="text-ink-soft text-xs leading-relaxed">
                          {conflict.speech_excerpt}
                        </p>
                      </div>
                    ) : null}
                    {conflict.memory_excerpt ? (
                      <div className="border-memory/25 bg-memory-soft rounded border p-2.5">
                        <p className="text-memory mb-1 text-[10px] font-semibold tracking-wide uppercase">
                          memória
                        </p>
                        <p className="text-ink-soft text-xs leading-relaxed">
                          {conflict.memory_excerpt}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-3 space-y-2">
                  <Select
                    aria-label={`Decisão sobre: ${conflict.title}`}
                    value={draft.decision}
                    onChange={(e) =>
                      setDrafts((d) => ({
                        ...d,
                        [conflict.id]: { ...draft, decision: e.target.value },
                      }))
                    }
                  >
                    {DECISIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>

                  {draft.decision === "manual_edit" ? (
                    <Textarea
                      rows={3}
                      placeholder="Escreva como este ponto deve ficar no texto."
                      aria-label="Redação definida por você"
                      value={draft.manualText}
                      onChange={(e) =>
                        setDrafts((d) => ({
                          ...d,
                          [conflict.id]: { ...draft, manualText: e.target.value },
                        }))
                      }
                    />
                  ) : null}

                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => decide(conflict.id)}
                    disabled={pending}
                  >
                    Registrar decisão
                  </Button>
                </div>
              </article>
            );
          })}

          {resolved.length ? (
            <section>
              <SectionLabel>Decididos</SectionLabel>
              <ul className="space-y-2">
                {resolved.map((conflict) => {
                  const decision = conflict.conflict_resolutions![0];
                  return (
                    <li
                      key={conflict.id}
                      className="border-line rounded-[var(--radius)] border px-3 py-2"
                    >
                      <p className="text-ink text-[13px]">{conflict.title}</p>
                      <p className="text-ink-faint mt-0.5 text-xs">
                        {DECISIONS.find((d) => d.value === decision.decision)?.label ??
                          decision.decision}{" "}
                        · {formatDateTime(decision.decided_at)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------- 4. REFLEXÃO */

function ReflectionPanel({ data, onError, onMessage }: PanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    data.reflection?.currentVersionId ?? data.versions[0]?.id ?? null,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const version = data.versions.find((v) => v.id === selectedVersionId) ?? data.versions[0] ?? null;
  const approved = version?.status === "approved";
  const blocked = data.conflicts.some((c) => c.blocking && !c.conflict_resolutions?.length);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    onError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) onError(result.error ?? "Falhou.");
      else {
        onMessage(success);
        setEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <Panel
      tone="reflection"
      icon={<PenLine size={15} aria-hidden />}
      title="Reflexão"
      subtitle="Texto inédito, versionado, aprovado por você."
    >
      {!data.dossier ? (
        <EmptyState
          title="A escrita vem depois da memória"
          description="Memória antes da escrita: a reflexão só é gerada quando a investigação termina."
        />
      ) : !version ? (
        <div className="space-y-4">
          <EmptyState
            title="Nenhuma versão escrita"
            description="Com o dossiê pronto e os conflitos decididos, o escritor monta o Context Pack e redige."
          />
          {blocked ? (
            <Alert tone="danger">
              Há um conflito factual de severidade alta em aberto. A geração fica bloqueada até você
              decidir.
            </Alert>
          ) : null}
          <Button
            variant="primary"
            className="w-full"
            disabled={pending || blocked}
            onClick={() =>
              run(() => generateReflection(data.session.id), "Reflexão escrita. Revise e edite.")
            }
          >
            {pending ? "Escrevendo…" : "Gerar reflexão"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Versão"
              value={version.id}
              onChange={(e) => {
                setSelectedVersionId(e.target.value);
                setEditing(false);
              }}
              className="h-8 w-auto text-xs"
            >
              {data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Versão {v.version_number}
                  {v.status === "approved" ? " — aprovada" : ""}
                  {v.origin === "human_edit" ? " (edição sua)" : ""}
                </option>
              ))}
            </Select>
            <Badge tone={version.origin === "human_edit" ? "accent" : "reflection"}>
              {version.origin === "human_edit" ? "editada por você" : "escrita pela IA"}
            </Badge>
            {version.model ? <Badge>{version.model}</Badge> : null}
            {version.word_count ? <Badge>{version.word_count} palavras</Badge> : null}
          </div>

          {editing ? (
            <>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={18}
                aria-label="Editar a reflexão"
                className="prose-editorial"
              />
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        saveReflectionEdit({
                          sessionId: data.session.id,
                          reflectionId: data.reflection!.id,
                          parentVersionId: version.id,
                          text: draft,
                        }),
                      "Nova versão criada. A anterior continua guardada.",
                    )
                  }
                >
                  Salvar como nova versão
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
              </div>
            </>
          ) : (
            <article className="prose-editorial border-line bg-surface-2/40 max-h-[32rem] overflow-y-auto rounded-[var(--radius)] border p-4">
              {version.text.split(/\n{2,}/).map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </article>
          )}

          {!editing ? (
            <div className="flex flex-wrap gap-2">
              {!approved ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDraft(version.text);
                      setEditing(true);
                    }}
                  >
                    <PenLine size={14} aria-hidden /> Editar
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          approveReflectionVersion({
                            sessionId: data.session.id,
                            reflectionId: data.reflection!.id,
                            versionId: version.id,
                          }),
                        "Versão aprovada. Agora a voz pode ser gerada.",
                      )
                    }
                  >
                    <Check size={14} aria-hidden /> Aprovar esta versão
                  </Button>
                </>
              ) : (
                <Badge tone="success">
                  <Check size={11} aria-hidden /> aprovada em {formatDateTime(version.approved_at)}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() => generateReflection(data.session.id), "Nova versão gerada pela IA.")
                }
              >
                Gerar outra versão
              </Button>
            </div>
          ) : null}

          {approved ? (
            <section className="border-line space-y-3 border-t pt-4">
              <SectionLabel>Voz</SectionLabel>
              {data.narration.url ? (
                <>
                  <audio src={data.narration.url} controls className="w-full" />
                  <a
                    href={data.narration.url}
                    download
                    className="text-accent inline-flex items-center gap-1.5 text-sm underline underline-offset-2"
                  >
                    <Download size={14} aria-hidden /> Baixar o áudio
                  </a>
                </>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => generateVoice({ sessionId: data.session.id, versionId: version.id }),
                      "Áudio gerado.",
                    )
                  }
                >
                  <Volume2 size={14} aria-hidden />
                  {pending ? "Gerando…" : "Gerar a narração"}
                </Button>
              )}

              <div className="pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        publishReflectionToMemory({
                          sessionId: data.session.id,
                          versionId: version.id,
                          title: data.reflection?.title ?? "Reflexão",
                        }),
                      "Reflexão devolvida à memória — pode participar de investigações futuras.",
                    )
                  }
                >
                  <BookOpen size={14} aria-hidden /> Devolver esta reflexão à memória
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------- auxiliares */

const PANEL_TONES = {
  speech: "border-speech/30",
  memory: "border-memory/30",
  inference: "border-inference/30",
  reflection: "border-reflection/30",
} as const;

const PANEL_LABEL_TONES = {
  speech: "text-speech",
  memory: "text-memory",
  inference: "text-inference",
  reflection: "text-reflection",
} as const;

function Panel({
  tone,
  icon,
  title,
  subtitle,
  children,
}: {
  tone: keyof typeof PANEL_TONES;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card as="section" className={`${PANEL_TONES[tone]} flex flex-col`}>
      <CardHeader>
        <div className={`flex items-center gap-2 ${PANEL_LABEL_TONES[tone]}`}>
          {icon}
          <CardTitle className="text-[15px]">{title}</CardTitle>
        </div>
        <Muted className="mt-1 text-xs">{subtitle}</Muted>
      </CardHeader>
      <CardBody className="flex-1">{children}</CardBody>
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-ink-faint mb-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
      {children}
    </p>
  );
}

function ownerKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    chunk: "Trecho de documento",
    claim: "Afirmação",
    episode: "Relato anterior",
    reflection: "Reflexão aprovada",
    section_summary: "Resumo de seção",
    source_summary: "Resumo do documento",
  };
  return labels[kind] ?? kind;
}

export { CLASSIFICATION_LABELS };
