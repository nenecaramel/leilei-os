import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CONTENT_AUTHORS, isContentAuthor } from "../src/domains/content-author.js";

test("content author vocabulary includes exactly L G C", () => {
  assert.deepEqual(CONTENT_AUTHORS, ["L", "G", "C"]);
  assert.equal(isContentAuthor("L"), true);
  assert.equal(isContentAuthor("G"), true);
  assert.equal(isContentAuthor("C"), true);
  assert.equal(isContentAuthor("Claude"), false);
  assert.equal(isContentAuthor(null), false);
});

test("C author migration is additive and does not rewrite business rows", () => {
  const migration = readFileSync("drizzle/0032_content_author_c.sql", "utf8");

  assert.match(
    migration,
    /ALTER TYPE\s+"public"\."content_author"\s+ADD VALUE(?: IF NOT EXISTS)?\s+'C'/i,
  );
  assert.doesNotMatch(migration, /\bUPDATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\b/i);
  assert.doesNotMatch(migration, /\bDROP\b/i);
});
