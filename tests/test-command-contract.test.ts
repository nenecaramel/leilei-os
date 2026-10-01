import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("root test script is the deterministic CSS-aware canonical gate", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts?: { test?: string };
  };

  assert.match(packageJson.scripts?.test ?? "", /--import \.\/tests\/register-css-loader\.mjs/);
  assert.match(packageJson.scripts?.test ?? "", /--test-concurrency=1/);
});

test("CI runs the canonical suite without a baseline-flake allowlist", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /run: pnpm test/);
  assert.doesNotMatch(workflow, /known_baseline_flakes/);
});
