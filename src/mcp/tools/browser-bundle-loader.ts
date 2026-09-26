import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export function loadMcpBrowserBundle(input: {
  compiledUrl: URL;
  sourceUrl: URL;
}): string {
  try {
    return readFileSync(input.compiledUrl, "utf8");
  } catch (error) {
    if (!isMissingFile(error) || process.env.NODE_ENV === "production") {
      throw error;
    }
  }

  const require = createRequire(import.meta.url);
  const { buildSync } = require("esbuild") as typeof import("esbuild");
  const result = buildSync({
    entryPoints: [fileURLToPath(input.sourceUrl)],
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
    throw new Error("MCP browser bundle was not produced.");
  }
  return output;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT"
  );
}
