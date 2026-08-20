import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/domains/memory/memory-repository.ts", import.meta.url),
  "utf8",
);

test("Memory repository persists every supplied editable Web field", () => {
  const start = source.indexOf("async updateMemory(");
  const end = source.indexOf("async archiveMemory(", start);
  assert.ok(start >= 0 && end > start);
  const update = source.slice(start, end);

  assert.match(update, /input\.key === undefined/);
  assert.match(update, /input\.category === undefined/);
  assert.match(update, /input\.content === undefined/);
  assert.match(update, /tags:\s*input\.tags/);
  assert.match(update, /author:\s*input\.author/);
});

test("Memory MCP repository update accepts partial fields and preserves empty tags", () => {
  assert.match(source, /export type UpdateMemoryInput = \{[\s\S]*?key\?: string;[\s\S]*?category\?: MemoryCategory;[\s\S]*?content\?: string;[\s\S]*?tags\?: string\[\];[\s\S]*?author\?: ContentAuthor;/);
  const start = source.indexOf("async updateMemory(");
  const end = source.indexOf("async archiveMemory(", start);
  const update = source.slice(start, end);
  assert.match(update, /input\.key === undefined/);
  assert.match(update, /input\.category === undefined/);
  assert.match(update, /input\.content === undefined/);
  assert.match(update, /input\.tags === undefined/);
  assert.match(update, /input\.author === undefined/);
});
