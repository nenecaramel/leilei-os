import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const entryPoint = resolve("src/mcp/tools/shared-paper-app/browser-runtime.ts");
const sourceOutput = resolve("src/mcp/tools/shared-paper-app/browser-runtime.js");
const distOutput = resolve("dist/mcp/tools/shared-paper-app/browser-runtime.js");
const checkOnly = process.argv.includes("--check");

const result = await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  write: false,
});
const output = result.outputFiles[0]?.text;
if (!output) throw new Error("Shared Paper App browser bundle was not produced");

if (checkOnly) {
  const committed = await readFile(sourceOutput, "utf8").catch(() => null);
  if (committed !== output) {
    console.error("Shared Paper App browser runtime is stale; run pnpm build.");
    process.exitCode = 1;
  } else {
    console.log("Shared Paper App browser runtime is fresh.");
  }
} else {
  await mkdir(dirname(sourceOutput), { recursive: true });
  await mkdir(dirname(distOutput), { recursive: true });
  await writeFile(sourceOutput, output, "utf8");
  await writeFile(distOutput, output, "utf8");
}
