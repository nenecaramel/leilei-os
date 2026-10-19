import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, openSync, closeSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("hosted Settings uses native importer callbacks and preserves preview/restore state", {
  skip: process.platform !== "darwin" || !process.env.SETTINGS_HOSTED_SIMULATOR
    ? "Requires SETTINGS_HOSTED_SIMULATOR (disposable simulator)" : false,
}, () => {
  const simulator = process.env.SETTINGS_HOSTED_SIMULATOR!;
  const directory = process.env.SETTINGS_HOSTED_CACHE ?? mkdtempSync(join(tmpdir(), "leileios-settings-host-"));
  const bundle = "com.leileios.tests.settings-hosted";
  mkdirSync(directory, { recursive: true });
  try {
    cpSync("ios/LeileiOS", join(directory, "ios"), { recursive: true, filter: p => !p.includes("xcuserdata") });
    const fixture = readFileSync("tests/fixtures/settings/hosted-acceptance.swift", "utf8").split("// SAME_FILE_RESTORE_PROBES");
    assert.equal(fixture.length, 2);
    const source = join(directory, "ios/LeileiOS/Navigation/Settings/SettingsRestoreContent.swift");
    let restore = readFileSync(source, "utf8");
    assert.equal(restore.split(".formStyle(.grouped)").length, 2);
    // Only add a same-file task/probe in the disposable compilation copy.
    // The production body, fileImporter closure and @State remain unchanged.
    restore = restore.replace(".formStyle(.grouped)", ".task { await runHostedAcceptance() }\n        .formStyle(.grouped)");
    if (process.env.SETTINGS_HOSTED_NEGATIVE === "1") {
      const guard = "guard let generation = prepareRestorePreview(fileURL: url) else { return }";
      assert.ok(restore.includes(guard));
      restore = restore.replace(guard, "let generation = previewGeneration");
    }
    writeFileSync(source, restore + "\n" + fixture[1]);
    writeFileSync(join(directory, "ios/LeileiOS/App/LeileiOSApp.swift"), fixture[0]);
    const build = spawnSync("xcodebuild", ["-project", join(directory, "ios/LeileiOS.xcodeproj"), "-scheme", "LeileiOS", "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", join(directory, "build"), "ARCHS=arm64", "ONLY_ACTIVE_ARCH=YES", "COMPILER_INDEX_STORE_ENABLE=NO", "CODE_SIGNING_ALLOWED=NO", `PRODUCT_BUNDLE_IDENTIFIER=${bundle}`, "build"], { encoding: "utf8", timeout: 600_000, maxBuffer: 30_000_000 });
    writeFileSync(join(directory, "build.log"), build.stdout + build.stderr);
    assert.equal(build.status, 0, (build.stdout + build.stderr).split("\n").filter(l => l.includes("error:")).join("\n"));
    const install = spawnSync("xcrun", ["simctl", "install", simulator, join(directory, "build/Build/Products/Debug-iphonesimulator/LeileiOS.app")], { encoding: "utf8" });
    assert.equal(install.status, 0, install.stderr);
    const fd = openSync(join(directory, "run.log"), "w");
    const run = spawnSync("xcrun", ["simctl", "launch", "--console", "--terminate-running-process", simulator, bundle], { stdio: ["ignore", fd, fd], timeout: 180_000 });
    closeSync(fd);
    const output = readFileSync(join(directory, "run.log"), "utf8");
    console.info(output.split("\n").filter(l => /Settings hosted/.test(l)).join("\n"));
    assert.ifError(run.error);
    assert.equal(run.status, 0, output.slice(-8000));
    assert.match(output, /Settings hosted acceptance PASS/);
  } finally {
    spawnSync("xcrun", ["simctl", "uninstall", simulator, bundle]);
    if (!process.env.SETTINGS_HOSTED_CACHE) rmSync(directory, { recursive: true, force: true });
  }
});
