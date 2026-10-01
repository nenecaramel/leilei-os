import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Diary comments schema and migration preserve canonical ownership and lifecycle cascade", () => {
  const schema = readFileSync("src/database/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0037_diary_comments.sql", "utf8");
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };

  assert.match(schema, /export const diaryComments = pgTable/);
  assert.match(schema, /diary_comments_user_diary_fk/);
  assert.match(schema, /onDelete\("cascade"\)/);
  assert.match(schema, /diary_comments_revision_positive/);
  assert.match(schema, /diary_comments_content_limit/);
  assert.match(migration, /CREATE TABLE "diary_comments"/);
  assert.match(migration, /ON DELETE cascade/);
  assert.match(migration, /"revision" integer DEFAULT 1 NOT NULL/);
  assert.match(migration, /char_length\("diary_comments"\."content"\) <= 10000/);
  assert.match(migration, /add_diary_comment/);
  assert.match(migration, /diary_comment/);
  assert.match(schema, /\| "add_diary_comment"/);
  assert.match(schema, /\| "diary_comment"/);
  assert.deepEqual(journal.entries.find((entry) => entry.tag === "0037_diary_comments"), {
    idx: 37,
    version: "7",
    when: Date.parse("2026-09-14T02:00:00Z"),
    tag: "0037_diary_comments",
    breakpoints: true,
  });
});
