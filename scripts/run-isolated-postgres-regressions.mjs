import { spawnSync } from "node:child_process";

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

let databaseUrl;
try {
  databaseUrl = new URL(process.env.DATABASE_URL);
} catch {
  fail("DATABASE_URL is not a valid URL");
}

const databaseName = decodeURIComponent(
  databaseUrl.pathname.replace(/^\//u, ""),
);
if (!/(?:test|ci|regression|ephemeral|scratch)/iu.test(databaseName)) {
  fail(
    `database name "${databaseName || "<empty>"}" is not explicitly test/CI/regression-scoped`,
  );
}

if (
  process.env.RAILWAY_ENVIRONMENT_NAME?.toLowerCase() === "production"
  || process.env.NODE_ENV?.toLowerCase() === "production"
) {
  fail("refusing to run in a production-marked environment");
}

const env = {
  ...process.env,
  RUN_NATIVE_LIVE_CONVERSATION_DATABASE_TEST: "1",
  RUN_RUNTIME_BREATH_DATABASE_TEST: "1",
  RUN_RUNTIME_MIND_PRODUCT_DATABASE_TEST: "1",
  RUN_PROJECT_WORKSPACE_DATABASE_TEST: "1",
  RUN_RUNTIME_LIFECYCLE_DATABASE_TEST: "1",
  RUN_RUNTIME_CURIOSITY_RESOLUTION_DATABASE_TEST: "1",
  RUN_NATIVE_LIVE_MIND_FOLLOWUP_DATABASE_TEST: "1",
  RUN_NATIVE_LIVE_SEMANTIC_DATABASE_TEST: "1",
  RUN_NATIVE_LIVE_TURN_DATABASE_TEST: "1",
  RUN_RUNTIME_MIND_DATABASE_TEST: "1",
  RUN_NATIVE_LIVE_RELAY_DATABASE_TEST: "1",
  RUN_NATIVE_LIVE_PROVIDER_SESSION_STORE_DATABASE_TEST: "1",
  RUN_NATIVE_LIVE_EXTERNAL_HISTORY_DATABASE_TEST: "1",
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
  "tests/native-live-conversation-repository.integration.test.ts",
  "tests/runtime-breath-recall-repository.integration.test.ts",
  "tests/mind-product-repository.integration.test.ts",
  "tests/project-workspace-repository.integration.test.ts",
  "tests/runtime-memory-lifecycle-repository.integration.test.ts",
  "tests/runtime-curiosity-resolution-idempotency.integration.test.ts",
  "tests/native-live-mind-followup.integration.test.ts",
  "tests/native-live-semantic-handshake.integration.test.ts",
  "tests/native-live-backend-turn-repository.integration.test.ts",
  "tests/native-live-backend-relay.integration.test.ts",
  "tests/runtime-subject-state-repository.integration.test.ts",
  "tests/native-live-background-model-queue.integration.test.ts",
  "tests/native-live-provider-session-store.integration.test.ts",
  "tests/native-live-external-history.integration.test.ts",
]);
