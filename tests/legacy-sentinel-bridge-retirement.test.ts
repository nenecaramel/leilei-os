import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../drizzle/0085_retire_legacy_sentinel_bridge.sql",
  import.meta.url,
);
const schemaPath = new URL(
  "../src/database/schema.ts",
  import.meta.url,
);
const retentionPath = new URL(
  "../src/domains/retention/runtime-operational-retention.ts",
  import.meta.url,
);
const journalPath = new URL("../drizzle/meta/_journal.json", import.meta.url);

test("0085 retires only the legacy Sentinel and Bridge persistence chain", async () => {
  const migration = await readFile(migrationPath, "utf8");

  const wake = migration.indexOf('DROP TABLE "sentinel_wake_runs"');
  const sentinel = migration.indexOf('DROP TABLE "sentinels"');
  const lease = migration.indexOf('DROP TABLE "bridge_listener_leases"');
  const events = migration.indexOf('DROP TABLE "bridge_events"');

  assert.ok(wake >= 0);
  assert.ok(sentinel > wake);
  assert.ok(lease > sentinel);
  assert.ok(events > lease);

  assert.doesNotMatch(migration, /user_settings/i);
  assert.doesNotMatch(migration, /native_live_runtime_listener_leases/i);
  assert.doesNotMatch(migration, /runtime_/i);
});

test("current schema and retention no longer depend on retired legacy tables", async () => {
  const [schema, retention] = await Promise.all([
    readFile(schemaPath, "utf8"),
    readFile(retentionPath, "utf8"),
  ]);

  for (const legacy of [
    "bridge_events",
    "sentinels",
    "sentinel_wake_runs",
    "bridge_listener_leases",
  ]) {
    assert.doesNotMatch(schema, new RegExp(legacy, "i"));
  }

  assert.doesNotMatch(retention, /bridge_listener_leases/i);
  assert.match(retention, /native_live_runtime_listener_leases/i);
  assert.match(schema, /user_settings/i);
});

test("0085 is the ordered migration head and preserves historical Sentinel migrations", async () => {
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ idx: number; when: number; tag: string }>;
  };
  const entries = journal.entries;
  const head = entries.at(-1);

  assert.equal(head?.idx, 85);
  assert.equal(head?.tag, "0085_retire_legacy_sentinel_bridge");
  assert.equal(
    entries.find((entry) => entry.idx === 30)?.tag,
    "0030_autonomous_sentinel",
  );
  assert.equal(
    entries.find((entry) => entry.idx === 31)?.tag,
    "0031_sentinel_hardening",
  );

  for (let index = 0; index < entries.length; index += 1) {
    assert.equal(entries[index]?.idx, index);
    if (index > 0) {
      assert.ok(
        (entries[index]?.when ?? 0) > (entries[index - 1]?.when ?? 0),
      );
    }
  }
});
