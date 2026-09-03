import { z } from "zod";

type JsonSchema = Record<string, unknown>;

/**
 * Converte um schema Zod em JSON Schema aceito pelo modo `strict` de
 * Structured Outputs: todo objeto precisa declarar `additionalProperties: false`
 * e listar TODAS as suas propriedades em `required`.
 *
 * Campos opcionais viram uniões com `null`, que é a forma suportada pelo modo
 * estrito — por isso os schemas do projeto usam `.nullable()` em vez de
 * `.optional()` sempre que o campo puder faltar.
 */
export function toStrictJsonSchema(schema: z.ZodType, name: string): JsonSchema {
  const raw = z.toJSONSchema(schema, { io: "output", target: "draft-2020-12" }) as JsonSchema;
  const strict = harden(raw);
  return { name, strict: true, schema: strict };
}

function harden(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(harden);
  if (!node || typeof node !== "object") return node;

  const obj = { ...(node as JsonSchema) };
  delete obj.$schema;
  delete obj.default;

  for (const key of Object.keys(obj)) {
    obj[key] = harden(obj[key]);
  }

  if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
    obj.additionalProperties = false;
    obj.required = Object.keys(obj.properties as JsonSchema);
  }

  return obj;
}
