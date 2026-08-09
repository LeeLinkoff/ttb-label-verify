// scripts/generate-openapi-schemas.ts
//
// Generates components.schemas for swagger-spec.ts directly from the
// actual TypeScript interfaces in services/, instead of hand-maintaining
// a parallel copy that can drift out of sync (see swagger-spec.ts
// history: it went stale twice before this existed).
//
// Run via `npm run generate:schemas`. Writes schemas.generated.ts,
// which swagger-spec.ts imports and spreads into components.schemas.
// Re-run any time a source interface changes; nothing watches this
// automatically, it's a manual build step by design so a schema change
// is a visible, reviewable diff rather than something that happens
// silently at request time.
//
// Only the types actually returned in API responses are generated here.
// Request-body shapes (multipart/form-data fields) aren't representable
// as a single exported TS interface the way responses are, those stay
// hand-authored in swagger-spec.ts.

import { createGenerator, Config } from "ts-json-schema-generator";
import * as fs from "fs";
import * as path from "path";

// Type name -> which file it's exported from. One generator run per
// type, ts-json-schema-generator wants a single root type per config.
const TARGET_TYPES: { typeName: string; sourceFile: string }[] = [
  { typeName: "FieldMatchResult", sourceFile: "services/matching.ts" },
  { typeName: "MatchResult", sourceFile: "services/matching.ts" },
  { typeName: "ApplicationData", sourceFile: "services/matching.ts" },
  { typeName: "BatchResultItem", sourceFile: "services/batch.ts" },
  { typeName: "ExtractedLabelFields", sourceFile: "services/extraction.ts" }
];

const TSCONFIG_PATH = path.join(__dirname, "..", "tsconfig.json");
const OUTPUT_PATH = path.join(__dirname, "..", "schemas.generated.ts");

function toOpenApiSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  // ts-json-schema-generator emits plain JSON Schema (draft-07-ish),
  // which is close to but not identical to what OpenAPI 3.0 expects.
  // OpenAPI 3.0 doesn't support the "$schema" meta field or nullable
  // via a `["string","null"]` type array (nullable is a sibling
  // `nullable: true` key instead, and JSON Schema $defs -> OpenAPI
  // components/schemas naming differs). This is a deliberately
  // narrow, non-exhaustive fixup: it only handles the constructs that
  // actually show up in this project's interfaces (plain objects,
  // strings, booleans, string|null unions, Record<string, T>). If a
  // future interface introduces something outside that shape, this
  // function will need to grow, it won't silently produce a wrong
  // schema, but it may leave a draft-07-only construct OpenAPI can't
  // render correctly, so know that this covers what's here today, not
  // the general case.
  const clone = JSON.parse(JSON.stringify(jsonSchema));
  delete clone.$schema;
  // Local `definitions` duplicate what the other generated schemas
  // already provide as top-level components.schemas entries once all
  // five are merged together, drop them so the $refs point at the one
  // shared copy instead of an embedded stale one.
  delete clone.definitions;

  function walk(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;

      // string | null (array-type form) -> nullable: true, type: string
      if (Array.isArray(obj.type) && obj.type.includes("null")) {
        const nonNullTypes = (obj.type as string[]).filter((t) => t !== "null");
        obj.type = nonNullTypes.length === 1 ? nonNullTypes[0] : nonNullTypes;
        obj.nullable = true;
      }

      // X | null (anyOf form, what ts-json-schema-generator emits for
      // an inline `{ ... } | null` TS union) -> the non-null branch's
      // schema, with nullable: true merged in. OpenAPI 3.0 has no
      // anyOf-with-null convention, it wants nullable as a sibling key.
      if (Array.isArray(obj.anyOf)) {
        const branches = obj.anyOf as Record<string, unknown>[];
        const nullBranch = branches.find((b) => b.type === "null");
        const nonNullBranches = branches.filter((b) => b.type !== "null");
        if (nullBranch && nonNullBranches.length === 1) {
          delete obj.anyOf;
          Object.assign(obj, nonNullBranches[0]);
          obj.nullable = true;
        }
      }

      // $ref pointing at #/definitions/X -> #/components/schemas/X
      if (typeof obj.$ref === "string") {
        obj.$ref = (obj.$ref as string).replace(
          "#/definitions/",
          "#/components/schemas/"
        );
      }

      for (const key of Object.keys(obj)) {
        obj[key] = walk(obj[key]);
      }
      return obj;
    }
    return node;
  }

  return walk(clone) as Record<string, unknown>;
}

function generateOne(typeName: string, sourceFile: string): Record<string, unknown> {
  const config: Config = {
    path: path.join(__dirname, "..", sourceFile),
    tsconfig: TSCONFIG_PATH,
    type: typeName,
    expose: "export",
    topRef: false,
    skipTypeCheck: false
  };

  const generator = createGenerator(config);
  const schema = generator.createSchema(typeName);
  return toOpenApiSchema(schema as unknown as Record<string, unknown>);
}

function main(): void {
  const schemas: Record<string, unknown> = {};

  for (const { typeName, sourceFile } of TARGET_TYPES) {
    try {
      schemas[typeName] = generateOne(typeName, sourceFile);
      console.log(`Generated schema for ${typeName} (${sourceFile})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to generate schema for ${typeName} (${sourceFile}): ${message}`);
      process.exitCode = 1;
    }
  }

  const fileContents =
    "// schemas.generated.ts\n" +
    "//\n" +
    "// AUTO-GENERATED by scripts/generate-openapi-schemas.ts. Do not edit by\n" +
    "// hand, edits will be overwritten on the next `npm run generate:schemas`.\n" +
    "// Source of truth is the actual TypeScript interfaces in services/.\n\n" +
    "export const generatedSchemas: Record<string, unknown> = " +
    JSON.stringify(schemas, null, 2) +
    " as const;\n";

  fs.writeFileSync(OUTPUT_PATH, fileContents, "utf-8");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
