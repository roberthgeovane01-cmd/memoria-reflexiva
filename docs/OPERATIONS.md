# Operação

## Backup

Três coisas independentes precisam de cópia.

**Banco de dados**

```bash
npx supabase db dump -f backup-$(date +%F).sql
```

No plano gratuito o backup automático do Supabase é limitado; rode o dump
manual com regularidade e guarde fora do mesmo computador.

**Arquivos** — os três buckets, pelo painel do Supabase ou pela CLI:
`library-originals`, `audio-originals`, `audio-generated`. São os originais
insubstituíveis: os livros que você enviou e os áudios que você gravou.

**Código** — já versionado no git.

## Restauração

1. Criar um projeto Supabase novo.
2. `npx supabase db push` (recria o schema pelas migrations).
3. Restaurar o dump de dados.
4. Reenviar os arquivos para os buckets, mantendo os caminhos
   `workspace_id/...` exatamente como estavam.
5. Atualizar as variáveis de ambiente na Vercel.

## Exclusão de um documento

Pela tela de detalhe. Remove, em ordem: o arquivo original no Storage e depois,
por cascade, versões, seções, resumos, trechos, vetores, vínculos de conceito,
afirmações e evidências. Não ficam dados órfãos.

Conceitos que ficaram sem nenhuma fonte permanecem com `occurrences` desatualizado
— são inofensivos e podem ser arquivados pela tela de Memória.

## Fila de trabalhos

`processing_jobs` guarda estado, tentativas, progresso, erro e `correlation_id`.
Estados: `pending → processing → completed | failed | cancelled`.

Um job travado pode ser reenfileirado pela tela de detalhe do documento
(**Reprocessar**), que remove o job antigo e cria um novo.

Para ver o que falhou:

```sql
select kind, error_message, attempts, created_at
from processing_jobs
where status = 'failed'
order by created_at desc;
```

## Custos

`audit_logs` guarda provider, modelo, latência, tokens e custo estimado por
chamada. Para o gasto por dia:

```sql
select date_trunc('day', created_at) as dia,
       action, model,
       sum(tokens_in) as entrada,
       sum(tokens_out) as saida,
       round(sum(estimated_cost)::numeric, 4) as custo_usd
from audit_logs
where estimated_cost is not null
group by 1, 2, 3
order by 1 desc;
```

A tabela de preços fica em `src/lib/audit.ts` e deve ser ajustada conforme a
tabela vigente do fornecedor.

## Trocar de modelo de embedding

1. Mude `EMBEDDING_MODEL` (e `EMBEDDING_DIMENSIONS`, se mudar).
2. O sistema cria automaticamente um novo `embedding_space`.
3. Reprocesse os documentos para gerar os vetores no espaço novo.
4. Vetores do espaço antigo continuam no banco e **nunca** são comparados com
   os novos.

## Rotação de chaves

Chaves comprometidas ou expostas devem ser revogadas no painel do fornecedor e
substituídas nas variáveis de ambiente da Vercel. Um novo deploy aplica.
Nenhuma chave está no repositório.
