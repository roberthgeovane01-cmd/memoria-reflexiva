# Publicação

## 1. Supabase

```bash
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

Depois, no painel:

- **Authentication → Providers → Email**: ative _Leaked password protection_.
- **Authentication → URL Configuration**: coloque o endereço da Vercel em
  _Site URL_ e em _Redirect URLs_.
- **Storage**: confirme que `library-originals`, `audio-originals` e
  `audio-generated` estão **privados**.

## 2. Vercel

**Add New → Project**, escolha o repositório, framework Next.js (detectado
automaticamente). Em **Environment Variables**:

| Variável                                                                   | Obrigatória                             |
| -------------------------------------------------------------------------- | --------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                                 | sim                                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                            | sim                                     |
| `OPENAI_API_KEY`                                                           | não (sem ela: modo demonstração)        |
| `TTS_API_KEY`                                                              | não (sem ela: voz em modo demonstração) |
| `ANALYSIS_MODEL`, `WRITER_MODEL`, `TRANSCRIPTION_MODEL`, `EMBEDDING_MODEL` | não (têm padrão)                        |
| `NEXT_PUBLIC_SITE_URL`                                                     | recomendada                             |
| `SUPABASE_SERVICE_ROLE_KEY`                                                | não                                     |

A rota `/api/jobs/run` declara `maxDuration = 300`. No plano gratuito o limite é
menor; livros muito longos podem precisar de mais de uma chamada. Basta
reprocessar o documento pela tela de detalhe.

## 3. Smoke test

Depois do deploy, percorra o fluxo inteiro no ambiente publicado:

1. `GET /api/health` responde `ok: true` e lista as capacidades ligadas.
2. Criar conta → o painel abre (workspace, estilo e voz criados automaticamente).
3. Biblioteca → adicionar um `.md` curto → status vira **na memória**.
4. Detalhe do documento → resumo, capítulos, trechos, conceitos e afirmações.
5. Nova reflexão → escrever um relato → mesa de revisão abre.
6. Aprovar a transcrição → **Investigar a memória** → dossiê com evidências.
7. Se houver conflito: registrar uma decisão.
8. Gerar reflexão → editar → conferir que a versão anterior continua na lista.
9. Aprovar → gerar a voz → ouvir e baixar.
10. **Como a memória chegou aqui?** → conferir consultas, scores e descartes.
11. Memória → pesquisar um conceito do documento.
12. Configurações → conferir quais capacidades estão ligadas.

Um item que falhe indica exatamente qual camada investigar.

## 4. Domínio próprio

**Settings → Domains** na Vercel. Depois atualize `NEXT_PUBLIC_SITE_URL` e as
URLs de autenticação no Supabase.

## 5. PWA

O aplicativo já declara `manifest.webmanifest`, tema, viewport e suporte a
instalação. Para o ícone aparecer, coloque `icon-192.png`, `icon-512.png` e
`icon-maskable.png` em `public/icons/`.
