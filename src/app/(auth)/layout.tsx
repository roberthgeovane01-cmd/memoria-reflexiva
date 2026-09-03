export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div id="conteudo" className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="font-serif text-2xl tracking-tight text-ink">Memória Reflexiva</h1>
          <p className="mt-2 text-sm text-ink-faint">
            Sua biblioteca, sua memória e a sua voz — investigando antes de escrever.
          </p>
        </header>
        {children}
      </div>
    </div>
  );
}
