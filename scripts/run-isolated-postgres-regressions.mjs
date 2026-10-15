import { spawnSync } from "node:child_process";
import { isolatedPostgresTarget, verifyIsolatedPostgresTarget } from "./isolated-postgres-target.mjs";

const REQUIRED_ACK = "RUN_ISOLATED_POSTGRES_REGRESSIONS";

function fail(message) {
  console.error(`isolated-postgres-regressions: ${message}`);
  process.exit(2);
}

if (process.env[REQUIRED_ACK] !== "1") {
  fail(
    `refusing to run without ${REQUIRED_ACK}=1; this suite performs destructive test mutations`,
  );
}

if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL is required");
}

try {
  const target = isolatedPostgresTarget(process.env.DATABASE_URL);
  await verifyIsolatedPostgresTarget(target);
  console.log("isolated-postgres-regressions: verified local test database/server (read-only)");
} catch (error) {
  fail(error.message);
}

const env = {
  ...process.env,
  RUN_DATABASE_TARGET_TEST: "1",
  RUN_NATIVE_LIVE_CONVERSATION_DATABASE_TEST: "1",
  RUN_CLAUDE_CODE_MIND_DATABASE_TEST: "1",
  RUN_RUNTIME_BREATH_DATABASE_TEST: "1",
  RUN_RUNTIME_MIND_PRODUCT_DATABASE_TEST: "1",
  RUN_GLOBAL_SEARCH_DATABASE_TEST: "1",
  RUN_RUNTIME_LIFECYCLE_DATABASE_TEST: "1",
  RUN_NATIVE_LIVE_MIND_FOLLOWUP_DATABASE_TEST: "1",
  RUN_NATIVE_LIVE_SEMANTIC_DATABASE_TEST: "1",
  RUN_NATIVE_LIVE_SEMANTIC_256_DATABASE_TEST: "1",
  RUN_NATIVE_LIVE_TURN_DATABASE_TEST: "1",
  RUN_RUNTIME_MIND_DATABASE_TEST: "1",
  RUN_MIND_MEMORY_MIGRATION_TEST: "1",
  RUN_NATIVE_LIVE_RELAY_DATABASE_TEST: "1",
  RUN_NATIVE_LIVE_PROVIDER_SESSION_STORE_DATABASE_TEST: "1",
  RUN_RETIRE_WORKSPACE_DATABASE_TEST: "1",
  RUN_NATIVE_LIVE_EXTERNAL_HISTORY_DATABASE_TEST: "1",
  RUN_CLAUDE_ACCOUNT_USAGE_DATABASE_TEST: "1",
};

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(args) {
  const result = spawnSync(pnpm, args, {
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["db:migrate"]);
run(["db:check"]);
run([
  "exec",
  "tsx",
  "--test",
  "--test-concurrency=1",
  "tests/isolated-postgres-target.integration.test.ts",
  "tests/native-live-conversation-repository.integration.test.ts",
  "tests/runtime-breath-recall-repository.integration.test.ts",
  "tests/claude-code-mind.integration.test.ts",
  "tests/claude-code-mind-finalized.integration.test.ts",
  "tests/mind-product-repository.integration.test.ts",
  "tests/global-search-repository.integration.test.ts",
  "tests/mind-memory-api.integration.test.ts",
  "tests/runtime-memory-lifecycle-repository.integration.test.ts",
  "tests/native-live-mind-followup.integration.test.ts",
  "tests/native-live-semantic-handshake.integration.test.ts",
  "tests/native-live-semantic-256.integration.test.ts",
  "tests/native-live-backend-turn-repository.integration.test.ts",
  "tests/native-live-branch-session.integration.test.ts",
  "tests/native-live-stale-replacement.integration.test.ts",
  "tests/native-live-silence-wake.integration.test.ts",
  "tests/native-live-wake-session-safety.integration.test.ts",
  "tests/native-live-backend-relay.integration.test.ts",
  "tests/runtime-subject-state-repository.integration.test.ts",
  "tests/mind-memory-migration.integration.test.ts",
  "tests/native-live-background-model-queue.integration.test.ts",
  "tests/native-live-provider-session-store.integration.test.ts",
  "tests/retire-product-workspace-migration.test.ts",
  "tests/retire-product-workspace-schema.integration.test.ts",
  "tests/native-live-external-history.integration.test.ts",
  "tests/claude-account-usage.integration.test.ts",
]);
