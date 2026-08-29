import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../drizzle/0030_autonomous_sentinel.sql",
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

test("autonomous Sentinel migration is the ordered 0030 journal head", async () => {
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ idx: number; when: number; tag: string }>;
  };
  const entries = journal.entries;
  const head = entries.at(-1);

  assert.ok(head, "migration journal must have a head entry");
  assert.equal(head.idx, 30);
  assert.equal(head.tag, "0030_autonomous_sentinel");

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
