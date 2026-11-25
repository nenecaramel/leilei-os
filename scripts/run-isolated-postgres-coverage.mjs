import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isolatedPostgresTarget, verifyIsolatedPostgresTarget } from "./isolated-postgres-target.mjs";

// The opt-in database tests no other runner lists. Several accept only a
// database with exactly this name, so they cannot share the regressions target.
const DATABASE = "leileios_native_session_test";
const REQUIRED_ACK = "RUN_ISOLATED_POSTGRES_REGRESSIONS";
const FILES = [
  "tests/diary-comment-repository.integration.test.ts",
  "tests/diary-permanent-delete.integration.test.ts",
  "tests/export-repository.integration.test.ts",
  "tests/health-v2-repository.integration.test.ts",
  "tests/import-repository.integration.test.ts",
  "tests/mcp-idempotency-retention.integration.test.ts",
  "tests/native-live-activity-duration.integration.test.ts",
  "tests/native-live-attachment-migration.integration.test.ts",
  "tests/native-live-completed-delivery.integration.test.ts",
  "tests/native-live-content-contract.integration.test.ts",
  "tests/native-live-conversation-bootstrap.integration.test.ts",
  "tests/native-live-durable-recovery.integration.test.ts",
  "tests/native-live-http-relay.integration.test.ts",
  "tests/native-live-lifecycle-boundaries.integration.test.ts",
  "tests/native-live-question-durable-trace.integration.test.ts",
  "tests/native-live-remote-checkpoint-recovery.integration.test.ts",
  "tests/native-live-structured-projection.integration.test.ts",
  "tests/native-live-task-state.integration.test.ts",
  "tests/native-live-tool-durable-activity.integration.test.ts",
  "tests/native-live-visible-thinking-durable.integration.test.ts",
  "tests/native-live-voice-lifecycle.integration.test.ts",
  "tests/native-session-continuation.integration.test.ts",
  "tests/native-session-history-repository.integration.test.ts",
  "tests/native-session-leileios-born-release.integration.test.ts",
  "tests/native-session-owner-cleanup.integration.test.ts",
  "tests/native-session-owner-predicate.integration.test.ts",
  "tests/native-session-owner-row.integration.test.ts",
  "tests/native-session-picker.integration.test.ts",
  "tests/native-session-preservation.integration.test.ts",
  "tests/native-session-release.integration.test.ts",
  "tests/native-session-rollback-preservation.integration.test.ts",
  "tests/native-session-scenario.integration.test.ts",
  "tests/native-session-turn-slot.integration.test.ts",
  "tests/permanent-delete-invariants.integration.test.ts",
  "tests/permanent-delete-rollback.integration.test.ts",
  "tests/system-repository.integration.test.ts",
  "tests/todo-repository.integration.test.ts",
  "tests/todo-search-repository.integration.test.ts",
  "tests/toy-command-repository.integration.test.ts",
  "tests/universe-repository.integration.test.ts",
  // Rewrites Universe tables, so it runs last.
  "tests/universe-weighted-switch-migration.integration.test.ts",
];

function fail(message) {
  console.error(`isolated-postgres-coverage: ${message}`);
  process.exit(2);
}

if (process.env[REQUIRED_ACK] !== "1") {
  fail(`refusing to run without ${REQUIRED_ACK}=1; this suite performs destructive test mutations`);
}
if (!process.env.DATABASE_URL) fail("DATABASE_URL is required");

try {
  const target = isolatedPostgresTarget(process.env.DATABASE_URL);
  if (target.database !== DATABASE) throw new Error(`database must be named ${DATABASE}`);
  await verifyIsolatedPostgresTarget(target);
  console.log("isolated-postgres-coverage: verified local test database/server (read-only)");
} catch (error) {
  fail(error.message);
}

// Each listed file names its own opt-in flags.
const flags = new Set(FILES.flatMap((file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8").match(/\bRUN_[A-Z0-9_]+/gu) ?? []));
const env = { ...process.env, ...Object.fromEntries([...flags].map((flag) => [flag, "1"])) };
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(args) {
  const result = spawnSync(pnpm, args, { env, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["db:migrate"]);
run(["exec", "tsx", "--test", "--test-concurrency=1", ...FILES]);
