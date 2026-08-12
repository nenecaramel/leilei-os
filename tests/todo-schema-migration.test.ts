import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  todoEntries,
  todoEntryKindEnum,
  todoPapers,
} from "../src/database/schema.js";

test("Todo schema exposes relational paper and entry tables", () => {
  assert.deepEqual(todoEntryKindEnum.enumValues, [
    "pending",
    "completed",
    "record",
  ]);

  assert.equal(todoPapers.userId.notNull, true);
  assert.equal(todoPapers.businessDate.notNull, true);
  assert.equal(todoPapers.author.notNull, true);
  assert.equal(todoPapers.revision.notNull, true);

  assert.equal(todoEntries.paperId.notNull, true);
  assert.equal(todoEntries.entryId.notNull, true);
  assert.equal(todoEntries.kind.notNull, true);
  assert.equal(todoEntries.text.notNull, true);
  assert.equal(todoEntries.position.notNull, true);
});

test("0016 Todo migration is additive and contains the required constraints", async () => {
  const sql = await readFile("drizzle/0016_todo_foundation.sql", "utf8");

  for (const expected of [
    "todo_entry_kind",
    "todo_papers",
    "todo_entries",
    "todo_papers_user_date_author_uidx",
    "todo_papers_revision_nonnegative",
    "todo_entries_paper_entry_uidx",
    "todo_entries_paper_position_uidx",
    "todo_entries_entry_id_nonblank",
    "todo_entries_text_nonblank",
    "todo_entries_position_nonnegative",
    "content_author",
  ]) {
    assert.match(sql, new RegExp(expected));
  }

  assert.match(
    sql,
    /todo_entry_kind[^;]*(pending)[^;]*(completed)[^;]*(record)/s,
  );
  assert.doesNotMatch(sql, /DROP TABLE|DROP TYPE|DROP COLUMN/i);
});
