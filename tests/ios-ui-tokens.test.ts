import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Real SwiftUI consumers: a wrong geometry/font/color mapping breaks the
// simulator assertions. No source-text snapshots or mock SwiftUI types.
test("UI-0 tokens preserve compact composer geometry and dynamic colors", {
  skip: process.platform !== "darwin",
}, () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "leilei-ui-tokens-"));
  try {
    const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], { encoding: "utf8" });
    assert.equal(sdk.status, 0, sdk.stderr);
    const executable = path.join(temporary, "checks");
    const compiled = spawnSync("xcrun", [
      "swiftc", "-sdk", sdk.stdout.trim(),
      "-target", `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-ios26.0-simulator`,
      "-parse-as-library", "-module-cache-path", path.join(temporary, "cache"),
      "ios/LeileiOS/LeileiOS/DesignSystem/LeileiUITokens.swift",
      "ios/LeileiOS/LeileiOS/Chat/ComposerComponents.swift",
      "tests/fixtures/ios-ui-tokens.swift", "-o", executable,
    ], { encoding: "utf8", timeout: 120_000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    // Compilation always runs on macOS; runtime checks need an explicitly
    // selected, already-booted local simulator, never a user's iPhone.
    if (process.env.UI_TOKEN_SIMULATOR_ID) {
      const checked = spawnSync("xcrun", ["simctl", "spawn", process.env.UI_TOKEN_SIMULATOR_ID, executable], {
        encoding: "utf8", timeout: 60_000,
      });
      assert.equal(checked.status, 0, checked.stderr);
      assert.match(checked.stdout, /UI token equivalence PASS/);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
