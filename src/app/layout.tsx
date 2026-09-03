import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Memória Reflexiva",
    template: "%s · Memória Reflexiva",
  },
  description:
    "Biblioteca pessoal, memória em camadas e reflexão narrada por voz — com investigação antes da escrita.",
  applicationName: "Memória Reflexiva",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Memória Reflexiva", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5f0" },
    { media: "(prefers-color-scheme: dark)", color: "#16150f" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <a href="#conteudo" className="skip-link">
          Pular para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
