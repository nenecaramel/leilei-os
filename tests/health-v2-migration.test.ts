import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readSchemaSource } from "./helpers/schema-source.js";

const migrationPath = new URL(
  "../drizzle/0033_health_v2_daily_summaries.sql",
  import.meta.url,
);
const journalPath = new URL("../drizzle/meta/_journal.json", import.meta.url);
const snapshotPath = new URL("../drizzle/meta/0033_snapshot.json", import.meta.url);
const historicalHealthMigrationPath = new URL(
  "../drizzle/0003_phase_5_health_schema.sql",
  import.meta.url,
);

test("Health v2 appends a daily-summary table without restoring the retired Health model", async () => {
  const schema = readSchemaSource();
  const migration = await readFile(migrationPath, "utf8");
  const snapshot = await readFile(snapshotPath, "utf8");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };

  assert.match(schema, /export const healthDailySummaries = pgTable\(/);
  assert.match(schema, /"health_daily_summaries"/);
  assert.match(schema, /health_daily_summaries_user_date_uidx/);
  for (const name of [
    "health_daily_summaries_steps_nonnegative",
    "health_daily_summaries_cycle_day_positive",
    "health_daily_summaries_cycle_pair",
    "health_daily_summaries_period_not_future",
    "health_daily_summaries_cycle_consistent",
  ]) {
    assert.match(schema, new RegExp(name));
    assert.match(migration, new RegExp(name));
  }

  for (const column of [
    "user_id",
    "date",
    "steps",
    "menstruating",
    "period_start_date",
    "cycle_day",
    "created_at",
    "updated_at",
  ]) {
    assert.match(migration, new RegExp(`"${column}"`));
  }

  assert.match(migration, /CREATE TABLE "health_daily_summaries"/);
  assert.match(migration, /FOREIGN KEY \("user_id"\).*ON DELETE restrict.*ON UPDATE cascade/is);
  assert.match(migration, /CREATE UNIQUE INDEX "health_daily_summaries_user_date_uidx"/);
  assert.doesNotMatch(migration, /^\s*(?:DROP|UPDATE|DELETE|TRUNCATE)\b/im);
  assert.match(
    migration,
    /^ALTER TABLE "health_daily_summaries" ADD CONSTRAINT "health_daily_summaries_user_id_users_id_fk"/m,
  );
  assert.equal((migration.match(/\bALTER TABLE\b/gi) ?? []).length, 1);
  assert.doesNotMatch(migration, /health_records/i);

  const healthEntries = journal.entries.filter((entry) => entry.idx === 33);
  assert.equal(healthEntries.length, 1);
  assert.equal(healthEntries[0]?.tag, "0033_health_v2_daily_summaries");
  assert.match(snapshot, /public\.health_daily_summaries/);
  assert.doesNotMatch(snapshot, /public\.health_records/);

  assert.doesNotMatch(schema, /healthRecords|health_records/);
  assert.match(
    await readFile(historicalHealthMigrationPath, "utf8"),
    /CREATE TABLE "health_records"/,
  );
});
