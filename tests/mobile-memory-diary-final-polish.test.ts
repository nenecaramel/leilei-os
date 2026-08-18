import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Memory Archive loading uses only the new skeleton", async () => {
  const source = await readFile(
    new URL("../web/src/pages/MemoryPage.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /MemoryMessage title="正在读取归档" description="正在读取归档…"/,
  );
});

test("Diary metadata inputs keep readable width without tiny size attributes", async () => {
  const source = await readFile(
    new URL("../web/src/pages/DiaryPaperEditor.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /size=\{Math\.max\(/);
  assert.match(source, /style=\{\{\s*width:\s*`\$\{Math\.max\(4,/);
});

test("Memory editable content and tags avoid iOS focus zoom", async () => {
  const css = await readFile(
    new URL("../web/src/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.memory-paper-content-editor\s*\{[\s\S]*?font-size:\s*16px;/,
  );
  assert.match(
    css,
    /\.memory-paper-tags\s*\{[\s\S]*?font-size:\s*16px;/,
  );
});

test("Archive and create glyphs keep the final darker middle gray while touch targets stay 44px", async () => {
  const css = await readFile(
    new URL("../web/src/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.memory-page-tools\s*>\s*button:nth-last-child\(-n\s*\+\s*2\)\s*\{[\s\S]*?color:\s*#444444;/,
  );
  assert.match(
    css,
    /\.memory-page-tools > button,[\s\S]*?\.memory-page-tool-wrap > button[\s\S]*?width:\s*44px;/,
  );
});
