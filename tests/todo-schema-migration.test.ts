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
  assert.equal(todoEntries.revision.notNull, true);
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

test("0017 extends only the durable MCP Todo idempotency checks", async () => {
  const sql = await readFile("drizzle/0017_mcp_todo_idempotency.sql", "utf8");

  assert.match(sql, /'write_todo_paper'/);
  assert.match(sql, /'todo_paper'/);
  assert.equal(
    (sql.match(/DROP CONSTRAINT "mcp_write_idempotency_tool_allowed"/g) ?? []).length,
    1,
  );
  assert.equal(
    (sql.match(/DROP CONSTRAINT "mcp_write_idempotency_resource_type_allowed"/g) ?? []).length,
    1,
  );
  assert.equal(
    (sql.match(/ADD CONSTRAINT "mcp_write_idempotency_tool_allowed"/g) ?? []).length,
    1,
  );
  assert.equal(
    (sql.match(/ADD CONSTRAINT "mcp_write_idempotency_resource_type_allowed"/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(
    sql,
    /CREATE\s+TABLE|ADD\s+COLUMN|DROP\s+COLUMN|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|ALTER\s+TABLE\s+"todo_/i,
  );
  assert.equal(
    (sql.match(/ALTER TABLE/g) ?? []).length,
    4,
    "only two drops and two adds are allowed",
  );
});

test("0038 adds entry revisions and Todo entry MCP idempotency without rewriting Todo data", async () => {
  const sql = await readFile("drizzle/0038_todo_entry_writes.sql", "utf8");

  assert.match(sql, /ALTER TABLE "todo_entries" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL/);
  assert.match(sql, /todo_entries_revision_positive/);
  for (const name of ["append_todo_entry", "update_todo_entry", "delete_todo_entry"]) {
    assert.match(sql, new RegExp(`'${name}'`));
  }
  assert.match(sql, /'todo_entry'/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE "todo_/i);
});
