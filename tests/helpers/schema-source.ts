import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const databaseDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/database",
);

/**
 * Full Drizzle schema source: the `schema.ts` facade plus every domain module
 * under `schema/`. Source-text guard tests read this instead of `schema.ts`
 * alone so their assertions keep covering every table declaration.
 */
export function readSchemaSource(): string {
  const moduleDirectory = join(databaseDirectory, "schema");
  const moduleFiles = readdirSync(moduleDirectory)
    .filter((file) => file.endsWith(".ts"))
    .sort();
  return [
    readFileSync(join(databaseDirectory, "schema.ts"), "utf8"),
    ...moduleFiles.map((file) => readFileSync(join(moduleDirectory, file), "utf8")),
  ].join("\n");
}
