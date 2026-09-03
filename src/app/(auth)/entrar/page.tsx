import Link from "next/link";
import type { Metadata } from "next";
import { SignInForm } from "@/features/auth/sign-in-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function EntrarPage(props: {
  searchParams: Promise<{ proximo?: string }>;
}) {
  const { proximo } = await props.searchParams;

  return (
    <>
      <SignInForm next={proximo ?? "/"} />
      <p className="mt-6 text-center text-sm text-ink-faint">
        Ainda não tem conta?{" "}
        <Link href="/cadastro" className="text-accent underline underline-offset-2">
          Criar conta
        </Link>
      </p>
    </>
  );
}
