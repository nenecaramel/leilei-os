import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PWA virtual register module has an explicit repository-local TypeScript contract", async () => {
  const source = await readFile(
    "web/src/pwa/virtual-pwa-register.d.ts",
    "utf8",
  );

  assert.match(
    source,
    /declare module ["']virtual:pwa-register["']/,
  );
  assert.match(
    source,
    /RegisterSWOptions.*vite-plugin-pwa\/types/s,
  );
  assert.match(
    source,
    /registerSW\(\s*options\?: RegisterSWOptions,\s*\):\s*\(\s*reloadPage\?: boolean,\s*\)\s*=>\s*Promise<void>/s,
  );
});
