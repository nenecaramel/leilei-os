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

test("migration journal ends at Universe weighted membership expand", async () => {
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: Array<{ tag: string }> };
  assert.equal(journal.entries.at(-1)?.tag, "0021_universe_weighted_membership_switch");
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
