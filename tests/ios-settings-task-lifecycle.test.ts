import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { swiftDeclarations } from "./helpers/ios-swift-declarations.js";
let directory: string, executable: string;
const mac = process.platform === "darwin";
before(() => {
  if (!mac) return;
  directory = mkdtempSync(join(tmpdir(), "settings-tasks-")); executable = join(directory, "check");
  const root = "ios/LeileiOS/LeileiOS/Navigation/Settings/";
  const restore = swiftDeclarations(root + "SettingsRestoreContent.swift");
  const exportMethod = swiftDeclarations(root + "SettingsExportContent.swift")("func_decl", "exportData()");
  const service = readFileSync(root + "SettingsDataService.swift", "utf8");
  const models = service.split("final class LeileiSettingsDataService")[0];
  const error = swiftDeclarations(root + "SettingsDataService.swift")("func_decl", "settingsDataErrorMessage(_:)");
  const api = readFileSync("ios/LeileiOS/LeileiOS/Infrastructure/LeileiAPIClient.swift", "utf8").split("@MainActor")[0];
  const source = readFileSync(root + "SettingsRestoreContent.swift", "utf8");
  const start = source.indexOf("    private var canRestore:"), end = source.indexOf("    var body:", start);
  assert.ok(start >= 0 && end > start);
  const fixture = readFileSync("tests/fixtures/settings/task-lifecycle.swift", "utf8")
    .replace("// RESTORE_METHODS", ["prepareRestorePreview(fileURL:)", "previewRestore(fileURL:generation:)", "restoreData()"].map(name => restore("func_decl", name)).join("\n"))
    .replace("// CAN_RESTORE", source.slice(start, end)).replace("// EXPORT_METHOD", exportMethod);
  writeFileSync(join(directory, "main.swift"), [models, api, error, fixture].join("\n"));
  execFileSync("swiftc", ["-module-cache-path", join(directory, "cache"), join(directory, "main.swift"), "-o", executable], { encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
});
after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
for (const scenario of ["preview-race", "preview-same-file-race", "selection-before-task-start", "selection-during-restore", "preview-failure-race", "restore-single-flight", "stale-preview", "export-single-flight"]) {
  test(`actual Swift Settings ${scenario}`, { skip: !mac }, () => {
    const output = execFileSync(executable, [scenario], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    assert.match(output, new RegExp(`PASS ${scenario}`));
  });
}
