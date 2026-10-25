import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { testPlan } from "../scripts/run-tests.mjs";

test("root test script is the deterministic CSS-aware canonical gate", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts?: { test?: string };
  };

  assert.equal(packageJson.scripts?.test, "node scripts/run-tests.mjs");
  const plan = testPlan(resolve("."), [], {});
  assert.equal(plan.argv[plan.argv.indexOf("--import") + 1], resolve("tests/register-css-loader.mjs"));
  assert.ok(plan.argv.includes("--test-concurrency=2"));
  assert.ok(testPlan(resolve("."), ["--serial"], {}).argv.includes("--test-concurrency=1"));
});

test("CI runs the canonical suite without a baseline-flake allowlist", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /run: pnpm test/);
  assert.doesNotMatch(workflow, /known_baseline_flakes/);
});

// Verify declared local command inputs without executing setup/network/DB scripts.
test("package scripts reference existing local executable and test files", () => {
  for (const manifest of ["package.json", "web/package.json", "tools/claude-bridge/package.json"]) {
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {scripts: Record<string, string>};
    const directory = resolve(manifest, "..");
    for (const [name, command] of Object.entries(pkg.scripts)) {
      for (const match of command.matchAll(/(?:^|\s)((?:scripts|tests|test|src)\/[\w./-]+\.(?:ts|mjs|sh|py))(?=\s|$)/g)) {
        assert.ok(existsSync(resolve(directory, match[1]!)), `${manifest} ${name}: missing ${match[1]}`);
      }
    }
  }
});

test("named suites list existing, unique test files and keep the gate serial", async () => {
  const { suitePlan } = await import("../scripts/run-suite.mjs");
  const suites = JSON.parse(readFileSync(new URL("../tests/suites.json", import.meta.url), "utf8")) as Record<string, { serial: boolean; tsx: string[]; node: string[] }>;
  for (const [name, suite] of Object.entries(suites)) {
    const files = [...suite.tsx, ...suite.node];
    assert.ok(files.length > 0, name);
    assert.equal(new Set(files).size, files.length, `${name}: duplicate test file`);
    for (const file of files) assert.ok(existsSync(resolve(file)), `${name}: missing ${file}`);
  }
  const root = resolve(".");
  const [tsx, node] = suitePlan(root, "production-runtime-gate");
  assert.deepEqual(tsx!.slice(1, 3), ["--test", "--test-concurrency=1"]);
  assert.deepEqual(tsx!.slice(3), suites["production-runtime-gate"]!.tsx);
  assert.deepEqual(node, ["--test", ...suites["production-runtime-gate"]!.node]);
  assert.equal(suitePlan(root, "native-live-minimal").length, 1);
  assert.throws(() => suitePlan(root, "toString"), /Unknown test suite/);
});
