/**
 * Gera as expressões SQL dos vetores de consulta da PROVA DO CÉREBRO.
 * Usa exatamente o mesmo embedding que o aplicativo usaria em modo
 * demonstração — nenhuma consulta é preparada à mão.
 *
 *   npx tsx scripts/brain-proof-queries.ts
 */
import { hashingEmbedding } from "../src/ai/providers/mock";
import { heuristicQueryPlan } from "../src/services/retrieval/engine";

const DIMS = 1536;

export const RELATO = `Ontem fiquei ao lado de um amigo que estava sofrendo muito e não soube o
que dizer. Passei a tarde inteira em silêncio, só permanecendo perto. Fiquei
com a impressão de que deveria ter feito alguma coisa, de que ficar calado foi
uma forma de abandonar a pessoa. Isso foi em 2024.`;

export const CONSULTA_SEM_MEMORIA = `Preciso entender como funciona a manutenção preventiva de turbinas
de aviação comercial e quais são os intervalos de inspeção obrigatórios.`;

function sparse(text: string): string {
  const vector = hashingEmbedding(text, DIMS);
  const idx: number[] = [];
  const val: number[] = [];
  vector.forEach((v, i) => {
    if (Math.abs(v) >= 0.06) {
      idx.push(i);
      val.push(Number(v.toFixed(3)));
    }
  });
  return `public.mr_vector_from_sparse(${DIMS}, ARRAY[${idx.join(",")}]::int[], ARRAY[${val.join(",")}]::float8[])`;
}

const plano = heuristicQueryPlan(RELATO);

console.log("=== PLANO DE INVESTIGAÇÃO (heurístico, modo demonstração) ===");
console.log("questão central:", plano.central_question);
console.log("temas:", plano.themes.join(", "));
console.log("consultas:");
for (const q of plano.queries) console.log(`  [${q.level}] ${q.text}  — ${q.rationale}`);

console.log("\n=== VETORES ===");
console.log("-- consulta principal");
console.log(sparse(plano.central_question));
console.log("\n-- termos centrais");
console.log(sparse(plano.themes.slice(0, 4).join(" ")));
console.log("\n-- consulta sem memória (aviação)");
console.log(sparse(CONSULTA_SEM_MEMORIA));
