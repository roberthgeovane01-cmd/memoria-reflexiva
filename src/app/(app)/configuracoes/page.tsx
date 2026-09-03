import type { Metadata } from "next";
import { Check, X } from "lucide-react";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Muted,
  PageHeader,
} from "@/components/ui";
import { aiCapabilities, env } from "@/lib/env";
import { requireSession } from "@/lib/supabase/server";
import { formatBytes } from "@/lib/utils";

export const metadata: Metadata = { title: "Configurações" };
export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const { supabase, workspaceId, displayName } = await requireSession();
  const e = env();
  const capabilities = aiCapabilities();

  const [{ data: workspace }, { data: voice }, { count: jobsFailed }] = await Promise.all([
    supabase.from("workspaces").select("name, created_at").eq("id", workspaceId).maybeSingle(),
    supabase
      .from("voice_profiles")
      .select("name, provider, voice_id, is_cloned, consent_status")
      .eq("workspace_id", workspaceId)
      .eq("is_default", true)
      .maybeSingle(),
    supabase
      .from("processing_jobs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "failed"),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Configurações"
        description="O que está ligado, o que está no modo demonstração e onde mexer."
      />

      {capabilities.demoMode ? (
        <div className="mb-6">
          <Alert tone="inference" title="Algumas capacidades estão em modo demonstração">
            O aplicativo funciona inteiro assim. Para ligar a análise e a escrita com IA, defina as
            variáveis de ambiente no seu provedor de hospedagem (na Vercel: Project Settings →
            Environment Variables) e faça um novo deploy. As chaves nunca ficam no repositório.
          </Alert>
        </div>
      ) : null}

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Capacidades de IA</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            <Capability
              label="Transcrição de áudio"
              enabled={capabilities.transcription}
              detail={`${e.TRANSCRIPTION_PROVIDER} · ${e.TRANSCRIPTION_MODEL}`}
              variable="OPENAI_API_KEY"
            />
            <Capability
              label="Embeddings (busca semântica)"
              enabled={capabilities.embedding}
              detail={`${e.EMBEDDING_PROVIDER} · ${e.EMBEDDING_MODEL} · ${e.EMBEDDING_DIMENSIONS}d`}
              variable="OPENAI_API_KEY"
            />
            <Capability
              label="Análise (planner, evidências, conflitos, dossiê)"
              enabled={capabilities.llm}
              detail={`${e.LLM_PROVIDER} · ${e.ANALYSIS_MODEL}`}
              variable="OPENAI_API_KEY"
            />
            <Capability
              label="Escrita da reflexão"
              enabled={capabilities.llm}
              detail={`${e.LLM_PROVIDER} · ${e.WRITER_MODEL}`}
              variable="OPENAI_API_KEY"
            />
            <Capability
              label="Voz (text-to-speech)"
              enabled={capabilities.tts}
              detail={`${e.TTS_PROVIDER} · ${e.TTS_MODEL}`}
              variable="TTS_API_KEY"
            />
            <Capability
              label="OCR de PDFs digitalizados"
              enabled={e.OCR_PROVIDER !== "none"}
              detail={e.OCR_PROVIDER}
              variable="OCR_PROVIDER"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Voz</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label="Perfil padrão" value={(voice?.name as string) ?? "—"} />
            <Row label="Provedor" value={(voice?.provider as string) ?? "—"} />
            <Row
              label="Identificador da voz"
              value={(voice?.voice_id as string) ?? e.TTS_VOICE_ID}
            />
            <Row
              label="Voz clonada"
              value={voice?.is_cloned ? `sim · consentimento ${voice.consent_status}` : "não"}
            />
            <Muted className="pt-2 text-xs">
              Voz de terceiros nunca é clonada. Uma voz personalizada só funciona com consentimento
              explícito registrado.
            </Muted>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Limites e parâmetros</CardTitle>
            <Muted className="mt-1 text-xs">
              São limites do MVP, configuráveis — não restrições permanentes da arquitetura.
            </Muted>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label="Tamanho máximo de documento" value={formatBytes(e.MAX_DOCUMENT_BYTES)} />
            <Row label="Tamanho máximo de áudio" value={formatBytes(e.MAX_AUDIO_BYTES)} />
            <Row label="Alvo por trecho" value={`${e.CHUNK_TARGET_TOKENS} tokens`} />
            <Row label="Sobreposição entre trechos" value={`${e.CHUNK_OVERLAP_TOKENS} tokens`} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conta e workspace</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label="Você" value={displayName ?? "—"} />
            <Row label="Workspace" value={(workspace?.name as string) ?? "—"} />
            <Row label="Jobs com falha" value={String(jobsFailed ?? 0)} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Privacidade</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="text-ink-soft space-y-2 text-sm">
              <li>
                Livros, textos, áudios, transcrições, memória, estilo, voz e reflexões são dados
                privados seus.
              </li>
              <li>
                Os três buckets de arquivos são privados; todo acesso passa por URL temporária
                assinada.
              </li>
              <li>
                A Row Level Security está ativa e forçada em todas as tabelas: outro usuário não lê,
                não altera e não baixa nada seu.
              </li>
              <li>
                Os registros de auditoria guardam metadados (modelo, latência, tokens, custo) — não
                o conteúdo pessoal.
              </li>
              <li>
                Todo conteúdo de documento é tratado como dado não confiável: uma instrução escrita
                dentro de um livro nunca vira comando para a IA.
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Capability({
  label,
  enabled,
  detail,
  variable,
}: {
  label: string;
  enabled: boolean;
  detail: string;
  variable: string;
}) {
  return (
    <div className="border-line/60 flex flex-wrap items-center justify-between gap-2 border-b py-2">
      <div className="flex items-center gap-2">
        {enabled ? (
          <Check size={15} className="text-success" aria-hidden />
        ) : (
          <X size={15} className="text-ink-faint" aria-hidden />
        )}
        <span className="text-ink text-sm">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-ink-faint text-xs">{detail}</span>
        <Badge tone={enabled ? "success" : "inference"}>
          {enabled ? "ligado" : `defina ${variable}`}
        </Badge>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line/60 flex justify-between gap-4 border-b py-1.5">
      <span className="text-ink-faint">{label}</span>
      <span className="text-ink-soft text-right">{value}</span>
    </div>
  );
}
