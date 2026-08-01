import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Task lifecycle migration is additive and defaults existing rows to active", async () => {
  const sql = await readFile(new URL("../drizzle/0011_clever_lifeguard.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TYPE "public"\."task_lifecycle_status" AS ENUM\('active', 'archived'\)/);
  assert.match(sql, /ADD COLUMN "lifecycle_status" "task_lifecycle_status" DEFAULT 'active' NOT NULL/);
  assert.match(sql, /tasks_user_lifecycle_due_created_idx/);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bDELETE\b|task_status|core_memories|diary_entries|tool_calls/i);
});
