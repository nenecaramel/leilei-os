import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = "ios/LeileiOS/LeileiOS/";
const ownerPath = root + "App/ConversationCoordination.swift";
const helper = root + "App/NativeLiveCurrentPathTransforms.swift";

test("current-path transformations are pure and coordination stays byte-for-byte conserved", () => {
  assert.ok(existsSync(helper));
  const source = readFileSync(helper, "utf8");
  assert.doesNotMatch(source.replace(/\/\/[^\n]*/g, ""), /AppModel|@State|Task|UserDefaults|api\./);
  // Conserved owner plus explicit legacy display-snapshot retirement.
  // All current-path request, state and coordination code remains pinned.
  assert.equal(createHash("sha256").update(readFileSync(ownerPath)).digest("hex"), "7d2a242130a0a4e4b3391efea623ac10a579efc481a96305971344a25eaa1840");
});

test("actual Swift current-path transforms preserve refresh, delta, anchors and metadata", { skip: process.platform !== "darwin" }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "current-path-transforms-"));
  try {
    let implementation = helper;
    if (!existsSync(helper)) {
      // Execute the original functions for pre-extraction characterization as well.
      const owner = readFileSync(ownerPath, "utf8");
      const start = owner.indexOf("    private func mergeNativeLiveRefresh(");
      const end = owner.indexOf("    private func reflectCurrentPathInConversationList()", start);
      implementation = path.join(dir, "Transforms.swift");
      writeFileSync(implementation, "import Foundation\nenum NativeLiveCurrentPathTransforms {\n" + owner.slice(start, end).replaceAll("private func ", "static func ") + "}\n");
    }
    const files = [root + "Infrastructure/NativeLiveRuntimeModels.swift", root + "Infrastructure/API/NativeLive/NativeLiveModels.swift", root + "Infrastructure/API/NativeLive/NativeLiveInputMode.swift", implementation, "tests/fixtures/current-path-transforms.swift"];
    const build = spawnSync("xcrun", ["swiftc", "-parse-as-library", "-module-cache-path", path.join(dir, "cache"), ...files, "-o", path.join(dir, "check")], { encoding: "utf8", timeout: 180000 });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(path.join(dir, "check"), [], { encoding: "utf8", timeout: 60000 });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Current path transforms PASS/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
