"use client";

import { useActionState } from "react";
import { Alert, Button, Card, CardBody, Input, Label, Muted } from "@/components/ui";
import { signUp, type AuthState } from "./actions";

const INITIAL: AuthState = { error: null };

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUp, INITIAL);

  return (
    <Card>
      <CardBody>
        <form action={formAction} className="space-y-4">
          <div>
            <Label htmlFor="displayName">Como devemos te chamar</Label>
            <Input id="displayName" name="displayName" autoComplete="name" required />
          </div>

          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>

          <div>
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              aria-describedby="senha-ajuda"
            />
            <Muted id="senha-ajuda" className="mt-1.5 text-xs">
              Pelo menos 8 caracteres.
            </Muted>
          </div>

          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.message ? <Alert tone="success">{state.message}</Alert> : null}

          <Button type="submit" variant="primary" className="w-full" disabled={pending}>
            {pending ? "Criando…" : "Criar conta"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
