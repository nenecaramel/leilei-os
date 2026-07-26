import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../drizzle/0006_large_chat.sql", import.meta.url);

test("Toy migration defines the constrained short-lived user queue", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /CREATE TABLE "toy_commands"/u);
  assert.match(sql, /"user_id" uuid NOT NULL/u);
  assert.match(sql, /FOREIGN KEY .*"users"\("id"\) ON DELETE restrict/u);
  assert.match(sql, /CREATE TYPE .*"toy_command_action".*'set'.*'stop'/su);
  assert.match(sql, /CREATE TYPE .*"toy_command_status".*'pending'.*'claimed'.*'completed'.*'failed'.*'expired'/su);
  assert.match(sql, /"percent" BETWEEN 1 AND 40/u);
  assert.match(sql, /"action" = 'stop' AND "toy_commands"."percent" IS NULL/u);
  assert.match(sql, /char_length\("toy_commands"."error"\) <= 500/u);
  assert.match(sql, /"expires_at" > "toy_commands"."created_at"/u);
  assert.match(sql, /"toy_commands_claim_queue_idx".*"user_id","status","expires_at","action","created_at","id"/u);
  assert.match(sql, /toy_commands_action_allowed.*IN \('set', 'stop'\)/u);
  assert.match(sql, /toy_commands_status_allowed.*'pending'.*'claimed'.*'completed'.*'failed'.*'expired'/u);
});
