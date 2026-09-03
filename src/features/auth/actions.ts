"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";

export type AuthState = { error: string | null; message?: string | null };

const credentials = z.object({
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres."),
});

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return {
      error:
        error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : `Não foi possível entrar: ${error.message}`,
    };
  }

  const next = String(formData.get("proximo") ?? "/");
  redirect(next.startsWith("/") ? next : "/");
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const schema = credentials.extend({
    displayName: z.string().min(2, "Diga como devemos te chamar."),
  });

  const parsed = schema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    displayName: String(formData.get("displayName") ?? "").trim(),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { display_name: parsed.data.displayName } },
  });

  if (error) return { error: `Não foi possível criar a conta: ${error.message}` };

  // Quando a confirmação por e-mail está ativa não há sessão imediata.
  if (!data.session) {
    return {
      error: null,
      message: "Conta criada. Confirme o endereço no e-mail que acabamos de enviar e depois entre.",
    };
  }

  redirect("/");
}
