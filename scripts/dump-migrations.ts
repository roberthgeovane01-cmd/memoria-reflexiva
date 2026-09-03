/**
 * Baixa as migrations já aplicadas no Supabase e grava em supabase/migrations/.
 * Usado apenas durante a construção inicial, quando as migrations foram
 * aplicadas via ferramenta administrativa. Depois disso, o repositório é a
 * fonte da verdade e este script serve como conferência.
 *
 *   npx tsx scripts/dump-migrations.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL / ANON_KEY em .env.local");

const supabase = createClient(url, key);
const outDir = resolve(process.cwd(), "supabase/migrations");
mkdirSync(outDir, { recursive: true });

const { data, error } = await supabase.rpc("mr_tmp_dump_migrations");
if (error) throw error;

type Row = { version: string; name: string; statements: string[] };
for (const row of (data ?? []) as Row[]) {
  const file = resolve(outDir, `${row.version}_${row.name}.sql`);
  writeFileSync(file, `${row.statements.join(";\n\n")}\n`, "utf8");
  console.log("gravado:", file);
}
console.log(`\n${(data ?? []).length} migration(s) gravada(s).`);
