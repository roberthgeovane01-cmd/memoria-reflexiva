import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Cliente Supabase do servidor, ligado à sessão do usuário.
 *
 * Decisão de arquitetura: quase tudo no aplicativo roda com a identidade do
 * próprio usuário, e não com a chave de serviço. Assim a RLS continua sendo a
 * última linha de defesa mesmo se houver um erro na camada de aplicação.
 */
export async function getServerSupabase(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const e = env();

  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Em Server Components a escrita de cookies é bloqueada; o refresh
          // de sessão acontece no proxy, então ignorar aqui é seguro.
        }
      },
    },
  });
}

export type SessionContext = {
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
  displayName: string | null;
  role: "owner" | "editor" | "reader";
};

/** Contexto exigido por toda ação autenticada. Lança se não houver sessão. */
export async function requireSession(): Promise<SessionContext> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) throw new UnauthenticatedError();

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) {
    throw new Error(
      "Nenhum workspace ativo encontrado para este usuário. " +
        "Isso indica falha no provisionamento do cadastro.",
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  return {
    supabase,
    userId: user.id,
    workspaceId: membership.workspace_id as string,
    displayName: (profile?.display_name as string | null) ?? null,
    role: membership.role as SessionContext["role"],
  };
}

/** Igual a requireSession, mas devolve null em vez de lançar. */
export async function getSession(): Promise<SessionContext | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Sessão não encontrada. Faça login para continuar.");
    this.name = "UnauthenticatedError";
  }
}
