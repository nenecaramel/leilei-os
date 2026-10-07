import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};

test("one-shot local SessionStore restore tooling stays retired", () => {
  assert.equal(
    packageJson.scripts?.["runtime:native-live-restore-current-session-local"],
    undefined,
  );
  assert.equal(
    existsSync("scripts/native-live-restore-current-session-local.ts"),
    false,
  );
});
