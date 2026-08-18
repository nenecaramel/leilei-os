import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../drizzle/0009_soft_master_chief.sql", import.meta.url),
  "utf8",
);

test("lifecycle audit migration adds only the generic append-only event table", () => {
  assert.match(
    migration,
    /CREATE TABLE "resource_lifecycle_events"/,
  );
  for (const column of [
    '"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL',
    '"user_id" uuid NOT NULL',
    '"resource_type" varchar(32) NOT NULL',
    '"resource_id" uuid NOT NULL',
    '"action" varchar(32) NOT NULL',
    '"actor_type" varchar(32) NOT NULL',
    '"channel" varchar(32) NOT NULL',
    `"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL`,
    '"created_at" timestamp with time zone DEFAULT now() NOT NULL',
  ]) {
    assert.ok(migration.includes(column), `missing ${column}`);
  }

  assert.match(
    migration,
    /FOREIGN KEY \("user_id"\).*"users"\("id"\) ON DELETE restrict ON UPDATE cascade/,
  );
  assert.doesNotMatch(
    migration,
    /FOREIGN KEY \("resource_id"\)/,
  );
  assert.match(
    migration,
    /"resource_lifecycle_events_user_created_idx".*"user_id","created_at" DESC/,
  );
  assert.match(
    migration,
    /"resource_lifecycle_events_resource_created_idx".*"resource_type","resource_id","created_at" DESC/,
  );
  assert.match(migration, /'memory', 'diary', 'task'/);
  assert.match(migration, /'archive', 'restore', 'permanent_delete'/);
  assert.match(migration, /'user', 'assistant', 'system'/);
  assert.match(migration, /'web', 'mcp', 'internal'/);
  assert.match(migration, /jsonb_typeof.*metadata.*= 'object'/);

  assert.doesNotMatch(
    migration,
    /^(?:UPDATE|DELETE FROM|DROP TABLE|TRUNCATE)\b/im,
  );
  assert.doesNotMatch(
    migration,
    /ALTER TABLE "(?:users|core_memories|diary_entries|tasks|tool_calls)"/,
  );
});
