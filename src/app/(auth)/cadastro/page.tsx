import Link from "next/link";
import type { Metadata } from "next";
import { SignUpForm } from "@/features/auth/sign-up-form";

export const metadata: Metadata = { title: "Criar conta" };

export default function CadastroPage() {
  return (
    <>
      <SignUpForm />
      <p className="mt-6 text-center text-sm text-ink-faint">
        Já tem conta?{" "}
        <Link href="/entrar" className="text-accent underline underline-offset-2">
          Entrar
        </Link>
      </p>
    </>
  );
}
