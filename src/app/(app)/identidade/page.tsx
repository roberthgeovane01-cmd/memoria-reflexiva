import type { Metadata } from "next";
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
import { StyleForm, type StyleProfileValues } from "@/features/style/style-form";
import { requireSession } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Identidade de escrita" };
export const dynamic = "force-dynamic";

const DEFAULTS: StyleProfileValues = {
  name: "Voz autoral padrão",
  tone: "reflexivo, sóbrio, próximo",
  perspective: "primeira pessoa",
  targetLength: "media",
  rhythm: "",
  structure: "",
  poeticity: 2,
  metaphorLevel: 2,
  vocabularyNotes: "",
  preferredExpressions: [],
  forbiddenExpressions: [],
  guidelines: "",
  authorizedValues: [],
  safetyRules: [],
  version: 1,
};

export default async function IdentidadePage() {
  const { supabase, workspaceId } = await requireSession();

  const { data: current } = await supabase
    .from("style_profiles")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .eq("is_default", true)
    .maybeSingle();

  const { data: history } = await supabase
    .from("style_profiles")
    .select("id, name, version, status, created_at")
    .eq("workspace_id", workspaceId)
    .order("version", { ascending: false })
    .limit(10);

  const initial: StyleProfileValues = current
    ? {
        name: (current.name as string) ?? DEFAULTS.name,
        tone: (current.tone as string) ?? "",
        perspective: (current.perspective as string) ?? "primeira pessoa",
        targetLength: (current.target_length as string) ?? "media",
        rhythm: (current.rhythm as string) ?? "",
        structure: (current.structure as string) ?? "",
        poeticity: (current.poeticity as number) ?? 2,
        metaphorLevel: (current.metaphor_level as number) ?? 2,
        vocabularyNotes: (current.vocabulary_notes as string) ?? "",
        preferredExpressions: (current.preferred_expressions as string[]) ?? [],
        forbiddenExpressions: (current.forbidden_expressions as string[]) ?? [],
        guidelines: (current.guidelines as string) ?? "",
        authorizedValues: (current.authorized_values as string[]) ?? [],
        safetyRules: (current.safety_rules as string[]) ?? [],
        version: (current.version as number) ?? 1,
      }
    : DEFAULTS;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Identidade de escrita"
        description="Como o sistema deve escrever quando escrever por você."
      />

      <div className="mb-6">
        <Alert tone="accent" title="Estilo não se copia da biblioteca">
          Ter um livro na memória não autoriza o sistema a imitar o estilo daquele autor. A reflexão
          usa este perfil — que é seu, e é versionado.
        </Alert>
      </div>

      <div className="space-y-6">
        <StyleForm initial={initial} />

        {(history ?? []).length > 1 ? (
          <Card>
            <CardHeader>
              <CardTitle>Versões anteriores</CardTitle>
              <Muted className="mt-1 text-xs">
                Reflexões antigas continuam apontando para a versão de estilo que as produziu.
              </Muted>
            </CardHeader>
            <CardBody className="divide-line divide-y p-0">
              {(history ?? []).map((profile) => (
                <div
                  key={profile.id as string}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div>
                    <p className="text-ink text-sm">
                      {profile.name as string} · v{profile.version as number}
                    </p>
                    <Muted className="text-xs">
                      {formatDateTime(profile.created_at as string)}
                    </Muted>
                  </div>
                  <Badge tone={profile.status === "active" ? "success" : "neutral"}>
                    {profile.status as string}
                  </Badge>
                </div>
              ))}
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
