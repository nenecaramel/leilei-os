import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Mac daemon prints canonical wake terminal outcomes directly", () => {
  const source = fs.readFileSync(
    "scripts/native-live-mac-daemon.ts",
    "utf8",
  );

  assert.match(source, /isWakeTerminalOutcome/u);
  assert.match(
    source,
    /outcome: wakeTerminalOutcome \?\? outcome\.outcome/u,
  );
  assert.match(
    source,
    /daemonOutcome: outcome\.outcome/u,
  );
  assert.match(source, /reason: fired\.reason/u);

  for (const value of [
    "wake_quiet",
    "wake_stale",
    "wake_failed",
    "wake_discarded",
  ]) {
    assert.match(source, new RegExp(value, "u"));
  }
});
