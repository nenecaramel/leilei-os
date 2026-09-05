import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../drizzle/0030_autonomous_sentinel.sql",
  import.meta.url,
);
const hardeningMigrationPath = new URL(
  "../drizzle/0031_sentinel_hardening.sql",
  import.meta.url,
);
const journalPath = new URL("../drizzle/meta/_journal.json", import.meta.url);

async function readOptionalFile(url: URL): Promise<string> {
  try {
    return await readFile(url, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

test("Sentinel migrations preserve the ordered 0030 predecessor and 0031 hardening entry", async () => {
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ idx: number; when: number; tag: string }>;
  };
  const entries = journal.entries;
  const previous = entries.find((entry) => entry.idx === 30);
  const hardening = entries.find((entry) => entry.idx === 31);

  assert.ok(hardening, "0031 Sentinel hardening entry must remain present");
  assert.equal(previous?.idx, 30);
  assert.equal(previous?.tag, "0030_autonomous_sentinel");
  assert.equal(hardening.idx, 31);
  assert.equal(hardening.tag, "0031_sentinel_hardening");

  for (let index = 0; index < entries.length; index += 1) {
    assert.equal(entries[index]?.idx, index, "journal indexes must remain contiguous");
    if (index > 0) {
      assert.ok(
        (entries[index]?.when ?? 0) > (entries[index - 1]?.when ?? 0),
        "journal timestamps must remain strictly increasing for the custom migration ledger",
      );
    }
  }
});

test("autonomous Sentinel migration adds durable wake state without rewriting message bodies", async () => {
  const migration = await readOptionalFile(migrationPath);

  assert.match(migration, /CREATE TABLE\s+"sentinels"/i);
  assert.match(migration, /CREATE TABLE\s+"sentinel_wake_runs"/i);

  assert.match(migration, /sentinels_user_id.*UNIQUE|UNIQUE INDEX\s+"sentinels_user_id/is);
  assert.match(migration, /sentinel_wake_runs.*cause.*scheduled.*wake_now.*recovery/is);
  assert.match(
    migration,
    /sentinel_wake_runs.*state.*bridge_enqueued.*claimed.*finalized.*superseded.*recovery_required/is,
  );
  assert.match(migration, /sentinel_wake_runs.*decision.*contact.*quiet/is);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX[^;]*sentinel_wake_runs[^;]*sentinel_id[^;]*WHERE[^;]*bridge_enqueued[^;]*claimed[^;]*recovery_required/is,
  );
  assert.match(migration, /CREATE INDEX[^;]*sentinel_wake_runs[^;]*user_id/is);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX[^;]*sentinel_wake_runs[^;]*bridge_event_id/is,
  );

  assert.match(migration, /ALTER TABLE\s+"bridge_events"\s+ADD COLUMN\s+"cancelled_at"/i);
  assert.match(migration, /bridge_events_kind_allowed[^;]*chat[^;]*wake/is);
  assert.match(
    migration,
    /bridge_events_source_allowed[^;]*leileios_pwa[^;]*leileios_sentinel/is,
  );

  assert.doesNotMatch(migration, /UPDATE\s+"?bridge_events"?/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+"?bridge_events"?/i);
  assert.doesNotMatch(migration, /ALTER\s+COLUMN\s+"(?:visible_text|model_context)"/i);
});

test("Sentinel hardening migration adds completion hash and consistency guards", async () => {
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const hardeningEntry = journal.entries.find((entry) => entry.idx === 31);
  assert.equal(hardeningEntry?.tag, "0031_sentinel_hardening");

  const migration = await readOptionalFile(hardeningMigrationPath);
  assert.match(migration, /"completion_payload_hash" varchar\(64\)/i);
  assert.match(migration, /sentinel_wake_runs_completion_payload_hash_format/i);
  assert.match(migration, /sentinels_active_wake_requires_null_next_wake/i);
  assert.match(migration, /sentinel_wake_runs_finalized_fields_required/i);
  assert.match(migration, /sentinel_wake_runs_non_finalized_fields_null/i);
  assert.match(migration, /sentinels_due_enabled_idle_idx/i);
});
