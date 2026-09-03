"use client";

import { useActionState } from "react";
import { Alert, Button, Card, CardBody, Input, Label } from "@/components/ui";
import { signIn, type AuthState } from "./actions";

const INITIAL: AuthState = { error: null };

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, INITIAL);

  return (
    <Card>
      <CardBody>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="proximo" value={next} />

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
              autoComplete="current-password"
              required
            />
          </div>

          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

          <Button type="submit" variant="primary" className="w-full" disabled={pending}>
            {pending ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
