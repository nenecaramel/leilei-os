import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../drizzle/0007_perpetual_bedlam.sql", import.meta.url),
  "utf8",
);

test("Task timezone migration only relaxes due_time and adds account timezone", () => {
  assert.match(
    migration,
    /ALTER TABLE "tasks" ALTER COLUMN "due_time" DROP NOT NULL/,
  );
  assert.match(
    migration,
    /ADD COLUMN "timezone" varchar\(64\) DEFAULT 'Asia\/Shanghai' NOT NULL/,
  );
  assert.match(migration, /user_settings_timezone_not_blank/);
  assert.doesNotMatch(migration, /ALTER COLUMN "due_time" TYPE/);
  assert.doesNotMatch(migration, /\bUPDATE\b|\bDELETE\b|\bDROP TABLE\b/i);
});

test("Task timezone migration preserves existing task rows and timestamps", () => {
  assert.doesNotMatch(migration, /CREATE TABLE "tasks"/);
  assert.doesNotMatch(migration, /INSERT INTO "tasks"/);
  assert.doesNotMatch(migration, /status/);
});
