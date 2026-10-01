import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readRepoFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("three-kind Mind migration preserves historical rows but fences future writes", () => {
  const migration = readRepoFile("drizzle/0092_runtime_mind_three_kind_check.sql");

  assert.match(
    migration,
    /"kind" NOT IN \('feel', 'memory', 'thought'\)/,
  );
  assert.match(
    migration,
    /TIMESTAMPTZ '2026-09-30 13:24:00\+00'/,
  );
  assert.match(
    migration,
    /CHECK \("kind" IN \('feel', 'memory', 'thought'\)\)\s+NOT VALID/,
  );
  assert.doesNotMatch(migration, /DELETE FROM "runtime_subject_states"/);
  assert.doesNotMatch(migration, /UPDATE "runtime_subject_states"/);
});

test("runtime schema advertises only the current three Mind kinds", () => {
  const schema = readRepoFile("src/database/schema.ts");
  const constraint = schema.match(
    /check\("runtime_subject_states_kind_allowed"[\s\S]*?\),/,
  )?.[0];

  assert.ok(constraint, "runtime_subject_states kind constraint must exist");
  assert.match(constraint, /'feel'/);
  assert.match(constraint, /'memory'/);
  assert.match(constraint, /'thought'/);
  assert.doesNotMatch(constraint, /'drive'|'curiosity'|'topic'|'dream'/);
});
