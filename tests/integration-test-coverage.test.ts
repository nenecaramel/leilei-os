import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// Opt-in database tests are skipped by `pnpm test`, so one that no runner
// lists never executes anywhere. Excluded files need a reason.
const EXCLUDED: Record<string, string> = {
  "tests/claude-photo-album-retirement.integration.test.ts": "the migration runner requires TLS; the CI service has none",
  "tests/universe-weighted-expand-migration.integration.test.ts": "needs a database from before migration 0020",
};
const RUNNERS = [
  ".github/workflows/ci.yml",
  "scripts/run-isolated-postgres-regressions.mjs",
  "scripts/run-isolated-postgres-coverage.mjs",
];

test("every opt-in database test is listed by a CI runner or excluded with a reason", () => {
  const listed = new Set(RUNNERS.flatMap(path => {
    let text = "";
    try { text = readFileSync(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return text.match(/tests\/[\w-]+\.integration\.test\.ts/gu) ?? [];
  }));
  const gated = readdirSync("tests").filter(name => name.endsWith(".integration.test.ts")).map(name => `tests/${name}`)
    .filter(path => /\bRUN_[A-Z0-9_]+/u.test(readFileSync(path, "utf8")));
  const unlisted = gated.filter(path => !listed.has(path) && !EXCLUDED[path]);
  assert.deepEqual(unlisted, []);
  for (const path of Object.keys(EXCLUDED)) {
    assert.ok(gated.includes(path), `${path} is excluded but no longer exists`);
    assert.ok(!listed.has(path), `${path} is both excluded and listed`);
  }
});

test("CI runs the coverage runner against its own database", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /run: pnpm test:isolated-postgres-coverage/u);
  assert.match(workflow, /POSTGRES_DB: leileios_native_session_test/u);
});
