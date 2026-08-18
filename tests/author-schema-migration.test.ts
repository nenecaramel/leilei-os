import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../drizzle/0015_lg_author_foundation.sql",
  import.meta.url,
);

test("L/G author migration is additive and preserves legacy nullability", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /content_author/);
  assert.match(migration, /core_memories/);
  assert.match(migration, /diary_entries/);
  assert.match(migration, /tasks/);
  assert.match(migration, /'L'/);
  assert.match(migration, /'G'/);
  assert.doesNotMatch(migration, /\bUPDATE\b/i);
  assert.doesNotMatch(migration, /\bINSERT\b/i);
  assert.doesNotMatch(migration, /\bDELETE\b/i);
  assert.doesNotMatch(migration, /author[^;]*NOT NULL/i);
  assert.doesNotMatch(migration, /todo_entries/i);
});

