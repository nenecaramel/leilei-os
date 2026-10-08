import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test(
  "actual Swift Memory edit encodes version, explicit null and timestamp",
  { skip: process.platform !== "darwin" },
  () => {
    const temporary = mkdtempSync(join(tmpdir(), "mind-kind-check-"));
    try {
      const executable = join(temporary, "check");
      const build = spawnSync(
        "swiftc",
        [
          "-module-cache-path",
          join(temporary, "cache"),
          "ios/LeileiOS/LeileiOS/Infrastructure/API/Mind/MindModels.swift",
          "tests/fixtures/mind/MemoryUpdate.swift",
          "-o",
          executable,
        ],
        { encoding: "utf8", timeout: 120000 },
      );
      assert.equal(build.status, 0, build.stderr);
      const run = spawnSync(executable, [], {
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /PASS/);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);
