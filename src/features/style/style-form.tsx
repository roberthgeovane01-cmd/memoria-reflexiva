"use client";

import { useActionState } from "react";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Muted,
  Select,
  Textarea,
} from "@/components/ui";
import { saveStyleProfile, type StyleState } from "./actions";

const INITIAL: StyleState = { error: null, message: null };

export type StyleProfileValues = {
  name: string;
  tone: string;
  perspective: string;
  targetLength: string;
  rhythm: string;
  structure: string;
  poeticity: number;
  metaphorLevel: number;
  vocabularyNotes: string;
  preferredExpressions: string[];
  forbiddenExpressions: string[];
  guidelines: string;
  authorizedValues: string[];
  safetyRules: string[];
  version: number;
};

export function StyleForm({ initial }: { initial: StyleProfileValues }) {
  const [state, formAction, pending] = useActionState(saveStyleProfile, INITIAL);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfil de estilo (versão {initial.version})</CardTitle>
        <Muted className="mt-1">
          Estilo é separado do conhecimento. A Biblioteca responde &quot;o que sabemos&quot;; este
          perfil responde &quot;como devemos escrever&quot;. Salvar cria uma nova versão.
        </Muted>
      </CardHeader>
      <CardBody>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">Nome do perfil</Label>
              <Input id="name" name="name" defaultValue={initial.name} required />
            </div>
            <div>
              <Label htmlFor="tone">Tom</Label>
              <Input
                id="tone"
                name="tone"
                defaultValue={initial.tone}
                placeholder="reflexivo, sóbrio, próximo"
              />
            </div>
            <div>
              <Label htmlFor="perspective">Perspectiva</Label>
              <Input id="perspective" name="perspective" defaultValue={initial.perspective} />
            </div>
            <div>
              <Label htmlFor="targetLength">Extensão</Label>
              <Select id="targetLength" name="targetLength" defaultValue={initial.targetLength}>
                <option value="curta">curta (até 250 palavras)</option>
                <option value="media">média (250 a 600 palavras)</option>
                <option value="longa">longa (600 a 1200 palavras)</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="rhythm">Ritmo</Label>
              <Input
                id="rhythm"
                name="rhythm"
                defaultValue={initial.rhythm}
                placeholder="frases curtas seguidas de uma longa"
              />
            </div>
            <div>
              <Label htmlFor="structure">Estrutura</Label>
              <Input
                id="structure"
                name="structure"
                defaultValue={initial.structure}
                placeholder="abre na cena, fecha sem moral"
              />
            </div>
            <div>
              <Label htmlFor="poeticity">Poeticidade (0 a 5)</Label>
              <Input
                id="poeticity"
                name="poeticity"
                type="number"
                min={0}
                max={5}
                defaultValue={initial.poeticity}
              />
            </div>
            <div>
              <Label htmlFor="metaphorLevel">Nível de metáfora (0 a 5)</Label>
              <Input
                id="metaphorLevel"
                name="metaphorLevel"
                type="number"
                min={0}
                max={5}
                defaultValue={initial.metaphorLevel}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="vocabularyNotes">Vocabulário</Label>
            <Textarea
              id="vocabularyNotes"
              name="vocabularyNotes"
              rows={2}
              defaultValue={initial.vocabularyNotes}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="preferredExpressions">Expressões preferidas</Label>
              <Textarea
                id="preferredExpressions"
                name="preferredExpressions"
                rows={3}
                defaultValue={initial.preferredExpressions.join("\n")}
                placeholder="uma por linha"
              />
            </div>
            <div>
              <Label htmlFor="forbiddenExpressions">Expressões proibidas</Label>
              <Textarea
                id="forbiddenExpressions"
                name="forbiddenExpressions"
                rows={3}
                defaultValue={initial.forbiddenExpressions.join("\n")}
                placeholder="uma por linha"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="guidelines">Diretrizes de escrita</Label>
            <Textarea
              id="guidelines"
              name="guidelines"
              rows={4}
              defaultValue={initial.guidelines}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="authorizedValues">Valores autorizados</Label>
              <Textarea
                id="authorizedValues"
                name="authorizedValues"
                rows={3}
                defaultValue={initial.authorizedValues.join("\n")}
                placeholder="princípios que você autoriza o texto a sustentar"
              />
            </div>
            <div>
              <Label htmlFor="safetyRules">Regras adicionais</Label>
              <Textarea
                id="safetyRules"
                name="safetyRules"
                rows={3}
                defaultValue={initial.safetyRules.join("\n")}
                placeholder="limites que o escritor nunca deve cruzar"
              />
            </div>
          </div>

          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.message ? <Alert tone="success">{state.message}</Alert> : null}

          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Salvando…" : "Salvar como nova versão"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
