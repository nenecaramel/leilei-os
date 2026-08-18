import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Diary lifecycle migration safely defaults existing rows to active", async () => {
  const sql = await readFile(
    new URL("../drizzle/0010_many_nico_minoru.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /diary_status.*'active'.*'archived'/s);
  assert.match(
    sql,
    /ADD COLUMN "status" "diary_status" DEFAULT 'active' NOT NULL/,
  );
  assert.match(sql, /user_status_date_created_idx/);
  assert.match(sql, /user_status_updated_id_idx/);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bDELETE\b|tool_calls|core_memories|tasks/i);
});
