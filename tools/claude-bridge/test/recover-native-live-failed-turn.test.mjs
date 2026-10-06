import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(
  new URL("../scripts/recover-native-live-failed-turn.mjs", import.meta.url),
);
const prepareId = "0cacbda8-78ba-43c9-b687-4e0eb0309d89";

function run(args) {
  return spawnSync(
    process.execPath,
    [script, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        LEILEI_NATIVE_LIVE_RELAY_URL: "http://127.0.0.1:1",
        LEILEI_NATIVE_LIVE_RELAY_TOKEN: "test-token",
      },
      timeout: 5_000,
    },
  );
}

test("failed-turn recovery initializes helpers before executing main", () => {
  const result = run([prepareId]);
  assert.notEqual(result.status, 0);
  const stderr = String(result.stderr);
  assert.doesNotMatch(
    stderr,
    /Cannot access 'InternalClient' before initialization/u,
  );
  assert.doesNotMatch(stderr, /Usage:/u);
});

test("failed-turn recovery accepts pnpm separator before prepare id", () => {
  const result = run(["--", prepareId]);
  assert.notEqual(result.status, 0);
  const stderr = String(result.stderr);
  assert.doesNotMatch(stderr, /Usage:/u);
  assert.doesNotMatch(
    stderr,
    /Cannot access 'InternalClient' before initialization/u,
  );
});
