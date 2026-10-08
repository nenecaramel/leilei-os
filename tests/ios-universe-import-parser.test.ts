import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const supported = process.platform === "darwin";
let temporary: string;
let executable: string;

before(() => {
  if (!supported) return;
  temporary = mkdtempSync(path.join(os.tmpdir(), "leilei-universe-import-"));
  executable = path.join(temporary, "checks");
  const parser = "ios/LeileiOS/LeileiOS/Pages/Universe/Import/UniverseImportParser.swift";
  // Compile the real Foundation-only code both before and after extraction.
  const compiled = spawnSync("xcrun", [
    "swiftc", "-parse-as-library", "-module-cache-path", path.join(temporary, "cache"),
    "ios/LeileiOS/LeileiOS/Pages/UniverseModels.swift",
    ...(existsSync(parser) ? [parser] : []),
    "tests/fixtures/universe-import-parser.swift", "-o", executable,
  ], { encoding: "utf8", timeout: 120_000 });
  assert.equal(compiled.status, 0, compiled.stderr);
});

after(() => {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
});

for (const check of ["parse", "invalid", "readback", "validation"]) {
  test(`real Swift Universe import preserves ${check} semantics`, { skip: !supported }, () => {
    const result = spawnSync(executable, [check], { encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `Universe import ${check} PASS`);
  });
}
