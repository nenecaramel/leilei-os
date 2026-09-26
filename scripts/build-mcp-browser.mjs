import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const bundles = [
  {
    name: "Note Card browser runtime",
    entryPoint:
      "src/mcp/tools/render-thinking-block/browser-runtime.ts",
    output:
      "dist/mcp/tools/render-thinking-block/browser-runtime.js",
  },
];

for (const bundle of bundles) {
  const result = await build({
    entryPoints: [resolve(bundle.entryPoint)],
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
  if (!output) {
    throw new Error(`${bundle.name} was not produced.`);
  }
  const outputPath = resolve(bundle.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, "utf8");
}
