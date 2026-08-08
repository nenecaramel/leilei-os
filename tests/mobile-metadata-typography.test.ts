import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Memory and Diary editable metadata prioritize real 16px iOS focus-safe inputs", async () => {
  const css = await readFile(
    new URL("../web/src/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    /\.memory-paper-metadata,\s*\.diary-paper-metadata\s*\{[\s\S]*?font-size:\s*13px;/,
  );
  assert.match(
    css,
    /\.memory-paper-tags,\s*\.diary-paper-mood,\s*\.diary-paper-tags\s*\{[\s\S]*?font-size:\s*16px;[\s\S]*?zoom:\s*1;/,
  );
});

test("Archive and create glyphs use the final darker middle gray", async () => {
  const css = await readFile(
    new URL("../web/src/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    /\.memory-page-tools\s*>\s*button:nth-last-child\(-n\s*\+\s*2\)\s*\{[\s\S]*?color:\s*#444444;/,
  );
});
