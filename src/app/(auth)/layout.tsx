export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div id="conteudo" className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-ink font-serif text-2xl tracking-tight">Memória Reflexiva</h1>
          <p className="text-ink-faint mt-2 text-sm">
            Sua biblioteca, sua memória e a sua voz — investigando antes de escrever.
          </p>
        </header>
        {children}
      </div>
    </div>
  );
}
