import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const entryPoint = resolve("src/mcp/tools/bridge-listener/browser-runtime.ts");
const sourceOutput = resolve("src/mcp/tools/bridge-listener/browser-runtime.js");
const distOutput = resolve("dist/mcp/tools/bridge-listener/browser-runtime.js");

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
if (!output) throw new Error("Bridge browser bundle was not produced");

await mkdir(dirname(sourceOutput), { recursive: true });
await mkdir(dirname(distOutput), { recursive: true });
await writeFile(sourceOutput, output, "utf8");
await writeFile(distOutput, output, "utf8");
