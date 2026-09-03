import Link from "next/link";
import { Badge } from "@/components/ui";
import { NavLinks } from "./nav-links";

export type ShellUser = {
  displayName: string | null;
  workspaceName: string;
};

/**
 * Casca da aplicação: navegação lateral no desktop, barra inferior no celular.
 * A metáfora não é a de um chat, é a de uma mesa editorial.
 */
export function AppShell({
  user,
  demoMode,
  children,
}: {
  user: ShellUser;
  demoMode: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-surface md:flex md:flex-col">
        <div className="border-b border-line px-5 py-5">
          <Link href="/" className="block">
            <p className="font-serif text-[17px] leading-tight tracking-tight text-ink">
              Memória Reflexiva
            </p>
            <p className="mt-0.5 truncate text-xs text-ink-faint">{user.workspaceName}</p>
          </Link>
        </div>

        <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto px-3 py-4">
          <NavLinks />
        </nav>

        <div className="space-y-3 border-t border-line px-5 py-4">
          {demoMode ? (
            <Badge tone="inference" className="w-full justify-center">
              modo demonstração
            </Badge>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs text-ink-faint">{user.displayName ?? "você"}</p>
            <form action="/auth/sair" method="post">
              <button
                type="submit"
                className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
              >
                sair
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
          <Link href="/" className="font-serif text-base tracking-tight">
            Memória Reflexiva
          </Link>
          {demoMode ? <Badge tone="inference">demo</Badge> : null}
        </header>

        <main id="conteudo" className="flex-1 px-4 pt-6 pb-28 md:px-10 md:py-10">
          {children}
        </main>

        <nav
          aria-label="Navegação"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur md:hidden"
        >
          <NavLinks compact />
        </nav>
      </div>
    </div>
  );
}
