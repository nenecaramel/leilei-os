import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readSchemaSource } from "./helpers/schema-source.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const retiredHealthRoutePattern = /\/api\/v1\/health(?=\/|["'])/u;
const read = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

function numberedFile(directory: string, number: number, extension: string): string {
  const file = fs.readdirSync(path.join(repoRoot, directory))
    .find((candidate) => candidate.startsWith(`${String(number).padStart(4, "0")}_`) && candidate.endsWith(extension));
  assert.ok(file, `expected migration ${number}`);
  return path.join(directory, file);
}

test("current Drizzle schema no longer exports the retired Health table", () => {
  const schema = readSchemaSource();
  assert.doesNotMatch(schema, /healthRecords/);
  assert.doesNotMatch(schema, /health_records/);
});

test("Stage B appends migration 0024 with a strict Health table drop", () => {
  const migrationPath = numberedFile("drizzle", 24, ".sql");
  assert.match(migrationPath, /drizzle\/0024_/);
  const migration = fs.readFileSync(path.join(repoRoot, migrationPath), "utf8");
  assert.equal(migration.trim(), 'DROP TABLE "health_records";');
  assert.doesNotMatch(migration, /CASCADE|IF EXISTS/);
});

test("current snapshot and journal append Stage B without rewriting history", () => {
  const snapshotPath = numberedFile("drizzle/meta", 24, ".json");
  assert.match(snapshotPath, /drizzle\/meta\/0024_/);
  const snapshot = read(snapshotPath);
  assert.doesNotMatch(snapshot, /public\.health_records|health_records/);

  const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.ok(journal.entries.length >= 27);
  assert.deepEqual(journal.entries.slice(0, 26).map(({ idx, tag }) => ({ idx, tag })), [
    { idx: 0, tag: "0000_phase_2_core_memory_schema" },
    { idx: 1, tag: "0001_phase_3_diary_audit_schema" },
    { idx: 2, tag: "0002_phase_4_task_schema" },
    { idx: 3, tag: "0003_phase_5_health_schema" },
    { idx: 4, tag: "0004_fuzzy_mentor" },
    { idx: 5, tag: "0005_clean_blue_shield" },
    { idx: 6, tag: "0006_large_chat" },
    { idx: 7, tag: "0007_perpetual_bedlam" },
    { idx: 8, tag: "0008_massive_azazel" },
    { idx: 9, tag: "0009_soft_master_chief" },
    { idx: 10, tag: "0010_many_nico_minoru" },
    { idx: 11, tag: "0011_clever_lifeguard" },
    { idx: 12, tag: "0012_unique_norman_osborn" },
    { idx: 13, tag: "0013_brief_shiver_man" },
    { idx: 14, tag: "0014_early_ozymandias" },
    { idx: 15, tag: "0015_lg_author_foundation" },
    { idx: 16, tag: "0016_todo_foundation" },
    { idx: 17, tag: "0017_mcp_todo_idempotency" },
    { idx: 18, tag: "0018_nifty_power_pack" },
    { idx: 19, tag: "0019_universe_domain" },
    { idx: 20, tag: "0020_weighted_galaxy_expand" },
    { idx: 21, tag: "0021_universe_weighted_membership_switch" },
    { idx: 22, tag: "0022_toy_duration" },
    { idx: 23, tag: "0023_faulty_sphinx" },
    { idx: 24, tag: "0024_brainy_wildside" },
    { idx: 25, tag: "0025_wild_xavin" },
  ]);
  const latestEntry = journal.entries.find(({ idx }) => idx === 26);
  assert.deepEqual(
    latestEntry && {
      idx: latestEntry.idx,
      version: (latestEntry as { version?: string }).version,
      tag: latestEntry.tag,
      breakpoints: (latestEntry as { breakpoints?: boolean }).breakpoints,
    },
    {
      idx: 26,
      version: "7",
      tag: "0026_universe_diary_provenance",
      breakpoints: true,
    },
  );
  assert.ok((latestEntry as { when?: number }).when);
});

test("historical Health migration remains available for provenance", () => {
  const historical = read("drizzle/0003_phase_5_health_schema.sql");
  assert.match(historical, /CREATE TABLE "health_records"/);
});

test("the infrastructure root healthcheck remains while the product API stays retired", () => {
  const app = read("src/app/create-app.ts");
  assert.match(app, /app\.get\("\/health"/);
  assert.match('app.get("/api/v1/health")', retiredHealthRoutePattern);
  assert.match('app.get("/api/v1/health/")', retiredHealthRoutePattern);
  assert.doesNotMatch('app.use("/api/v1/health-sync")', retiredHealthRoutePattern);
  assert.doesNotMatch(app, retiredHealthRoutePattern);
});
