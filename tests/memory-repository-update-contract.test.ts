import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/domains/memory/memory-repository.ts", import.meta.url),
  "utf8",
);

test("Memory repository persists every editable Web field", () => {
  const start = source.indexOf("async updateMemory(");
  const end = source.indexOf("async archiveMemory(", start);
  assert.ok(start >= 0 && end > start);
  const update = source.slice(start, end);

  assert.match(update, /key:\s*input\.key/);
  assert.match(update, /category:\s*input\.category/);
  assert.match(update, /content:\s*input\.content/);
  assert.match(update, /tags:\s*input\.tags/);
  assert.match(update, /author:\s*input\.author/);
});
