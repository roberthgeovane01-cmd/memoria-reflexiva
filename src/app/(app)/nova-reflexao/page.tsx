import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui";
import { AudioRecorder } from "@/features/audio/recorder";
import { TextSessionForm } from "@/features/reflections/text-session-form";
import { aiCapabilities } from "@/lib/env";
import { requireSession } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nova reflexão" };
export const dynamic = "force-dynamic";

export default async function NovaReflexaoPage(props: {
  searchParams: Promise<{ modo?: string }>;
}) {
  const { modo } = await props.searchParams;
  const { supabase, workspaceId } = await requireSession();
  const capabilities = aiCapabilities();

  const { count } = await supabase
    .from("sources")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "ready");

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Nova reflexão"
        description="Fale. Depois você revisa a transcrição, o sistema investiga a memória e só então a reflexão é escrita."
      />

      {count === 0 ? (
        <div className="mb-6">
          <Alert tone="inference" title="A biblioteca ainda está vazia">
            Você pode gravar mesmo assim: a memória episódica guarda o relato. Mas sem documentos na
            biblioteca, a investigação vai declarar ausência de memória em vez de inventar
            lembrança.
          </Alert>
        </div>
      ) : null}

      {!capabilities.transcription ? (
        <div className="mb-6">
          <Alert tone="inference" title="Transcrição automática desligada">
            Nenhuma chave de transcrição configurada. O áudio é salvo normalmente e você escreve a
            transcrição na mesa de revisão — que já é uma etapa obrigatória do fluxo.
          </Alert>
        </div>
      ) : null}

      <div className="space-y-6">
        <AudioRecorder initialMode={modo === "upload" ? "upload" : "gravar"} />
        <TextSessionForm />
      </div>
    </div>
  );
}
