import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Universe migration is additive and creates the six logical stores", async () => {
  const sql = await readFile(new URL("../drizzle/0019_universe_domain.sql", import.meta.url), "utf8");
  for (const table of ["universe_meta", "universe_galaxies", "universe_nodes", "universe_relations", "universe_revisions", "universe_backups"]) {
    assert.ok(sql.includes(`CREATE TABLE "${table}"`), `missing ${table}`);
  }
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/iu);
  assert.match(sql, /PRIMARY KEY\("user_id","id"\)/u);
  assert.match(sql, /universe_relations_user_source_target_type_uidx/u);
  assert.match(sql, /universe_revisions_snapshot_object/u);
  assert.match(sql, /universe_backups_no_recursive_backups/u);
  assert.match(sql, /"order" double precision NOT NULL/u);
  assert.match(sql, /"strength" double precision NOT NULL/u);
});

test("migration journal keeps the Universe switch before Toy duration", async () => {
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
  const universeEntry = journal.entries.find((entry) => entry.tag === "0021_universe_weighted_membership_switch");
  const toyEntry = journal.entries.find((entry) => entry.tag === "0022_toy_duration");
  assert.deepEqual(universeEntry && { idx: universeEntry.idx, tag: universeEntry.tag }, {
    idx: 21,
    tag: "0021_universe_weighted_membership_switch",
  });
  assert.deepEqual(toyEntry && { idx: toyEntry.idx, tag: toyEntry.tag }, {
    idx: 22,
    tag: "0022_toy_duration",
  });
});

test("0021 switch is a single fail-closed legacy membership gate", async () => {
  const sql = await readFile(new URL("../drizzle/0021_universe_weighted_membership_switch.sql", import.meta.url), "utf8");
  assert.equal(sql.split(/\n?--> statement-breakpoint\s*/).filter((value) => value.trim()).length, 1);
  assert.match(sql, /LOCK TABLE[\s\S]*SHARE ROW EXCLUSIVE MODE/u);
  assert.match(sql, /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/u);
  assert.match(sql, /universe_nodes_legacy_galaxies_empty/u);
  assert.match(sql, /cardinality\("galaxies"\) = 0/u);
  assert.doesNotMatch(sql, /DROP COLUMN|UPDATE|DELETE FROM/iu);
});

test("migration snapshot records canonical double precision columns", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../drizzle/meta/0019_snapshot.json", import.meta.url), "utf8")) as {
    tables: Record<string, { columns: Record<string, { type: string }> }>;
  };
  assert.equal(snapshot.tables["public.universe_galaxies"].columns.order.type, "double precision");
  assert.equal(snapshot.tables["public.universe_relations"].columns.strength.type, "double precision");
});

test("0026 creates owned Universe Diary provenance relations with cascading identity constraints", async () => {
  const sql = await readFile(new URL("../drizzle/0026_universe_diary_provenance.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE "universe_diary_sources"/u);
  assert.match(sql, /PRIMARY KEY\("user_id","node_id","diary_id"\)/u);
  assert.match(sql, /FOREIGN KEY \("user_id","node_id"\)[\s\S]*?ON DELETE cascade[\s\S]*?ON UPDATE cascade/u);
  assert.match(sql, /FOREIGN KEY \("user_id","diary_id"\)[\s\S]*?ON DELETE cascade[\s\S]*?ON UPDATE cascade/u);
  assert.match(sql, /diary_entries_user_id_id_uidx/u);
  assert.doesNotMatch(sql, /title|status|snapshot|metadata|created_at/u);
});
