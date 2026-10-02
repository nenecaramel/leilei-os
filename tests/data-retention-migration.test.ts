import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readSchemaSource } from "./helpers/schema-source.js";

type SnapshotIndex = {
  columns: Array<{ asc: boolean; expression: string }>;
};

type JournalEntry = {
  breakpoints: boolean;
  idx: number;
  tag: string;
  version: string;
  when: number;
};

type Snapshot = {
  tables: Record<string, { indexes: Record<string, SnapshotIndex> }>;
};

const migrationPath = "drizzle/0027_data_retention_indexes.sql";
const expectedIndexes = [
  {
    name: "mcp_write_idempotency_created_id_idx",
    table: "mcp_write_idempotency",
  },
  {
    name: "data_import_runs_created_id_idx",
    table: "data_import_runs",
  },
] as const;

test("0027 retention migration adds only the two age-order indexes", async () => {
  assert.equal(
    existsSync(migrationPath),
    true,
    "the additive retention migration must be checked in",
  );

  const [sql, schema, snapshotText, journalText] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readSchemaSource(),
    readFile("drizzle/meta/0027_snapshot.json", "utf8"),
    readFile("drizzle/meta/_journal.json", "utf8"),
  ]);
  const snapshot = JSON.parse(snapshotText) as Snapshot;
  const journal = JSON.parse(journalText) as { entries: JournalEntry[] };

  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  assert.equal(
    (sql.match(/\bCREATE\s+INDEX\b/gi) ?? []).length,
    2,
    "the migration must create exactly two indexes",
  );
  assert.equal(statements.length, 2, "the migration must contain only two statements");
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|ALTER\s+TABLE)\b/i);

  for (const { name, table } of expectedIndexes) {
    assert.match(
      sql,
      new RegExp(
        `CREATE\\s+INDEX\\s+"${name}"\\s+ON\\s+"${table}"\\s+USING\\s+btree\\s+\\(\\s*"created_at"\\s*,\\s*"id"\\s*\\)`,
        "i",
      ),
      `${name} must order by created_at then id`,
    );

    const snapshotIndex = snapshot.tables[`public.${table}`]?.indexes[name];
    assert.ok(snapshotIndex, `${name} must be present in the generated snapshot`);
    assert.deepEqual(
      snapshotIndex.columns.map(({ expression, asc }) => ({ expression, asc })),
      [
        { expression: "created_at", asc: true },
        { expression: "id", asc: true },
      ],
      `${name} must be ascending created_at then id in the snapshot`,
    );

    assert.match(
      schema,
      new RegExp(
        `index\\("${name}"\\)\\.on\\(\\s*table\\.createdAt\\.asc\\(\\),\\s*table\\.id\\.asc\\(\\),?\\s*\\)`,
        "s",
      ),
      `${name} must be declared in the Drizzle schema`,
    );
  }

  const retentionEntry = journal.entries.find((entry) => entry.idx === 27);
  assert.ok(retentionEntry, "0027 journal entry must be present");
  assert.deepEqual(journal.entries.at(26), {
    idx: 26,
    version: "7",
    when: 1787308495658,
    tag: "0026_universe_diary_provenance",
    breakpoints: true,
  });
  assert.equal(retentionEntry.tag, "0027_data_retention_indexes");
  assert.notEqual(retentionEntry.tag, "0027_data_retention_indexes.sql");
  assert.equal(retentionEntry.version, "7");
  assert.equal(retentionEntry.breakpoints, true);
  const looseMonsterEntry = journal.entries.find((entry) => entry.idx === 28);
  assert.equal(looseMonsterEntry?.tag, "0028_loose_monster_badoon");
  const tiresomeCorsairEntry = journal.entries.find((entry) => entry.idx === 29);
  assert.equal(tiresomeCorsairEntry?.tag, "0029_tiresome_corsair");
  const autonomousSentinelEntry = journal.entries.find((entry) => entry.idx === 30);
  assert.equal(autonomousSentinelEntry?.tag, "0030_autonomous_sentinel");
  const sentinelHardeningEntry = journal.entries.find((entry) => entry.idx === 31);
  assert.equal(sentinelHardeningEntry?.tag, "0031_sentinel_hardening");
});
