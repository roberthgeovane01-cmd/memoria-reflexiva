# Memória Reflexiva

> Biblioteca pessoal, memória em camadas e reflexão narrada por voz — com
> **investigação antes da escrita**.

Este README foi escrito para alguém que **não programa**. Cada passo diz o que
fazer, onde clicar e o que esperar. Se algo não bater com o que você vê na tela,
o texto entre parênteses explica o porquê.

---

## 1. O que é este aplicativo

Você coloca livros, textos e documentos na sua **Biblioteca**. Depois grava um
áudio contando um acontecimento, uma dúvida, uma ideia.

Antes de escrever qualquer coisa, o sistema **investiga a sua memória**:

```
FALA → TRANSCRIÇÃO → SUA REVISÃO → INVESTIGAÇÃO DA BIBLIOTECA
     → CRUZAMENTO DAS FONTES → CONFLITOS → DOSSIÊ DE MEMÓRIA
     → SUA DECISÃO → REFLEXÃO ESCRITA → SUA APROVAÇÃO → VOZ → DOWNLOAD
```

Não é um chat. É uma **mesa editorial**: quatro áreas lado a lado — a sua fala,
a memória recuperada, os conflitos encontrados e a reflexão escrita — e você
decide em cada etapa.

### O que o aplicativo nunca faz

- Não inventa fatos, datas, nomes, citações, lembranças ou opiniões suas.
- Não escreve "como você já disse antes" sem uma evidência real por trás.
- Não corrige você sozinho: quando a fala e a memória divergem, ele mostra as
  duas e espera a sua decisão.
- Não gera voz para um texto que você não aprovou (isso é bloqueado no banco de
  dados, não só na tela).
- Não obedece a instruções escritas dentro dos seus livros. Se um documento
  contiver "ignore todas as instruções anteriores", isso é apenas uma frase do
  documento.

---

## 2. Como funciona por dentro (em uma página)

| Camada           | O que responde                                                  |
| ---------------- | --------------------------------------------------------------- |
| **Biblioteca**   | O que foi colocado no sistema                                   |
| **Memória**      | O que o sistema consegue recuperar, relacionar e rastrear       |
| **Investigação** | O que a biblioteca tem a dizer sobre o que você acabou de falar |
| **Dossiê**       | A síntese rastreável, com a origem de cada afirmação            |
| **Escritor**     | O texto novo, no seu estilo, respeitando as suas decisões       |

Cada documento é quebrado assim:

```
FONTE → VERSÃO → RESUMO GLOBAL → CAPÍTULOS → RESUMOS DE CAPÍTULO
      → TRECHOS → CONCEITOS → AFIRMAÇÕES → EVIDÊNCIAS
```

E a busca acontece em três níveis, mais uma busca direta em paralelo:

1. **Global** — quais livros podem ter relação com o assunto?
2. **Capítulo** — onde, dentro desses livros, o assunto aparece?
3. **Evidência** — qual é o trecho concreto?
4. **Direta** — em paralelo, varre todos os trechos da biblioteca inteira, para
   que nada relevante fique de fora só porque o resumo do livro não citou o tema.

---

## 3. Contas que você precisa ter

| Serviço                               | Para quê                                        | Custo                             |
| ------------------------------------- | ----------------------------------------------- | --------------------------------- |
| [Supabase](https://supabase.com)      | banco de dados, login e arquivos                | plano gratuito serve para começar |
| [Vercel](https://vercel.com)          | hospedar o site                                 | plano gratuito serve para começar |
| [OpenAI](https://platform.openai.com) | transcrição, busca semântica, análise e escrita | pago por uso                      |
| [ElevenLabs](https://elevenlabs.io)   | voz                                             | pago por uso (opcional)           |

**Nada disso é obrigatório para o aplicativo subir.** Sem as chaves de IA ele
entra em **modo demonstração**: tudo funciona ponta a ponta com regras
determinísticas, e a interface avisa em cada resultado que a IA está desligada.

---

## 4. Instalação

Você precisa do [Node.js](https://nodejs.org) versão 20 ou maior.

```bash
git clone <endereço-do-repositório>
cd memoria-reflexiva
npm install
cp .env.example .env.local
```

Abra o arquivo `.env.local` num editor de texto e preencha:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
OPENAI_API_KEY=sk-...
TTS_API_KEY=sk_...
```

- As duas primeiras estão no painel do Supabase em
  **Project Settings → API** (`Project URL` e a chave `anon public`).
- `OPENAI_API_KEY` está em **API keys** no painel da OpenAI.
- `TTS_API_KEY` está no painel da ElevenLabs.

> **Nunca** coloque essas chaves em outro arquivo. O `.env.local` é ignorado pelo
> git de propósito: ele não vai para o repositório.

Depois:

```bash
npm run dev
```

Abra `http://localhost:3000` no navegador.

---

## 5. Configurar o Supabase

O banco inteiro é reproduzível pelas migrations que estão em
`supabase/migrations/`. Você não precisa criar tabela nenhuma na mão.

Com a [CLI do Supabase](https://supabase.com/docs/guides/local-development):

```bash
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

Isso cria, em ordem: extensões, busca em português, perfis e workspaces, os
três buckets privados, a biblioteca hierárquica, os vetores, a memória
semântica, os áudios e reflexões, a investigação, o estilo e a voz, as funções
de busca e todas as regras de segurança.

**Uma coisa precisa ser ligada à mão** (é uma opção de painel, não de banco):
em **Authentication → Providers → Email**, ative
_Leaked password protection_. Isso impede senhas que já vazaram na internet.

---

## 6. Como usar, no dia a dia

### Criar a conta

Abra o aplicativo e clique em **Criar conta**. No primeiro acesso o sistema já
prepara para você: um workspace pessoal, um perfil de estilo padrão e um perfil
de voz padrão.

### Colocar um livro na biblioteca

1. Vá em **Biblioteca**.
2. Escolha o arquivo (PDF com texto, DOCX, TXT ou Markdown).
3. Dê um título e escolha a **autoridade da fonte**:

   | Nível | Significado                         |
   | ----- | ----------------------------------- |
   | 5     | cânone / princípio que você aprovou |
   | 4     | livro ou texto autoral final        |
   | 3     | reflexão aprovada                   |
   | 2     | anotação                            |
   | 1     | rascunho                            |

4. Clique em **Adicionar documento** e espere. O processamento extrai o texto,
   identifica capítulos, resume, divide em trechos, gera os vetores de busca e
   extrai conceitos e afirmações.

> **PDF digitalizado (foto das páginas)**: o sistema detecta que não há texto
> utilizável e marca o documento como _precisa de OCR_, **sem** colocar lixo na
> memória. Ele fica visível na biblioteca com esse aviso.

### Gravar uma reflexão

1. **Nova reflexão** → **Começar a gravar** (ou enviar um arquivo de áudio, ou
   escrever o relato).
2. Ao finalizar, o áudio é salvo e transcrito, e a **Mesa de Revisão** abre.

### A Mesa de Revisão

Quatro áreas:

- **Sua fala** — o áudio e a transcrição. Corrija o que quiser e clique em
  _Aprovar transcrição_. Nada anda antes disso.
- **Memória** — clique em _Investigar a memória_. Aparece o dossiê com
  convergências, complementos, tensões, contradições, lacunas e a lista de
  evidências (cada uma com a fonte, a autoridade e os scores).
- **Conflitos** — cada divergência com as duas versões lado a lado e seis
  decisões possíveis. Um conflito factual grave **bloqueia** a escrita até você
  decidir.
- **Reflexão** — gere o texto, edite (cada edição vira uma nova versão, a
  anterior nunca é apagada), aprove, gere a voz e baixe o áudio.

### Ver como o sistema chegou lá

Em qualquer sessão, clique em **Como a memória chegou aqui?**. Você vê as
consultas executadas, os documentos e capítulos alcançados, os trechos usados,
os scores de cada etapa, o que foi descartado e por quê, os conflitos, as
decisões e as chamadas de IA com latência e custo estimado.

---

## 7. Testar se a memória está funcionando

```bash
npm test          # 46 testes de chunking, fusão, diversidade e investigação
npm run typecheck # verificação de tipos
npm run lint      # padrões de código
npm run build     # compila como em produção
```

Para provar o "cérebro" com dados fictícios, veja
[`docs/BRAIN_PROOF.md`](docs/BRAIN_PROOF.md) — inclui o conjunto de livros de
teste, o SQL de carga e os resultados reais medidos no banco.

---

## 8. Publicar na internet

1. Suba o repositório para o GitHub.
2. Em [vercel.com](https://vercel.com), **Add New → Project**, escolha o
   repositório.
3. Em **Environment Variables**, cole as mesmas variáveis do seu `.env.local`.
4. **Deploy**.
5. No Supabase, em **Authentication → URL Configuration**, coloque o endereço da
   Vercel em _Site URL_ e em _Redirect URLs_.

Detalhes e checklist completo em [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## 9. Backup

Seus livros e áudios são insubstituíveis. A rotina mínima:

- **Banco de dados**: no Supabase, _Database → Backups_. No plano gratuito o
  backup automático é limitado, então faça também um dump manual periódico:
  `npx supabase db dump -f backup-AAAA-MM-DD.sql`
- **Arquivos**: baixe os três buckets (`library-originals`, `audio-originals`,
  `audio-generated`) pelo painel do Supabase ou pela CLI.
- **Código**: já está no GitHub.

Guarde as cópias em um lugar que não seja o mesmo computador.
Passo a passo em [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

---

## 10. Documentação técnica

| Arquivo                                                 | Assunto                               |
| ------------------------------------------------------- | ------------------------------------- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)                 | visão geral e decisões de arquitetura |
| [DATABASE.md](docs/DATABASE.md)                         | tabelas, relações e políticas         |
| [LIBRARY.md](docs/LIBRARY.md)                           | modelo hierárquico da biblioteca      |
| [MEMORY_SYSTEM.md](docs/MEMORY_SYSTEM.md)               | as sete camadas de memória            |
| [INGESTION.md](docs/INGESTION.md)                       | pipeline de entrada de documentos     |
| [RAG.md](docs/RAG.md)                                   | busca híbrida e hierárquica           |
| [MEMORY_INVESTIGATION.md](docs/MEMORY_INVESTIGATION.md) | como a investigação roda              |
| [DOSSIER.md](docs/DOSSIER.md)                           | o Dossiê de Memória                   |
| [CONFLICT_ENGINE.md](docs/CONFLICT_ENGINE.md)           | motor de conflitos                    |
| [AI_PROMPTS.md](docs/AI_PROMPTS.md)                     | prompts versionados                   |
| [SECURITY.md](docs/SECURITY.md)                         | segurança, RLS e privacidade          |
| [TESTING.md](docs/TESTING.md)                           | estratégia de testes                  |
| [BRAIN_PROOF.md](docs/BRAIN_PROOF.md)                   | a prova do cérebro                    |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md)                     | publicação                            |
| [OPERATIONS.md](docs/OPERATIONS.md)                     | operação, backup e exclusão           |
| [IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md)     | diário da construção                  |

---

## 11. Princípio

> Não construa uma inteligência que apenas _pareça_ conhecer você.
> Construa uma inteligência capaz de demonstrar **por que acredita saber aquilo**.

Todo conhecimento importante neste sistema carrega origem, evidência, versão,
data, confiança e status.
