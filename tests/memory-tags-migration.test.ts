import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../drizzle/0008_massive_azazel.sql", import.meta.url),
  "utf8",
);

test("Memory tags migration adds a compatible empty constrained array", () => {
  assert.match(
    migration,
    /ADD COLUMN "tags" varchar\(50\)\[\] DEFAULT ARRAY\[\]::varchar\(50\)\[\] NOT NULL/,
  );
  assert.match(
    migration,
    /core_memories_tags_limit.*cardinality\("core_memories"\."tags"\) <= 20/,
  );
});

test("Memory tags migration preserves all existing Memory fields and rows", () => {
  assert.doesNotMatch(
    migration,
    /\bUPDATE\b|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bRENAME\b/i,
  );
  for (const field of [
    "id",
    "user_id",
    "key",
    "category",
    "content",
    "source",
    "status",
    "created_at",
    "updated_at",
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(`ALTER COLUMN "${field}"`, "i"),
    );
  }
});
