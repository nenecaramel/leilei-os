import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dataService = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Navigation/Settings/SettingsDataService.swift",
  "utf8",
);
const exportView = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Navigation/Settings/SettingsExportContent.swift",
  "utf8",
);
const restoreView = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Navigation/Settings/SettingsRestoreContent.swift",
  "utf8",
);
const settingsView = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Navigation/SettingsSheetView.swift",
  "utf8",
);
const summaryView = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Navigation/Settings/SettingsSummaryContent.swift",
  "utf8",
);
const apiClient = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Infrastructure/API/Import/ImportModels.swift",
  "utf8",
);

test("iOS keeps the existing Summary Export Restore Settings structure", () => {
  assert.match(settingsView, /case summary/);
  assert.match(settingsView, /case export/);
  assert.match(settingsView, /case restore/);
  assert.match(settingsView, /SettingsSummaryContent\(dataService: dataService\)/);
  assert.match(settingsView, /SettingsExportContent\(dataService: dataService\)/);
  assert.match(settingsView, /SettingsRestoreContent\(dataService: dataService\)/);

  assert.match(exportView, /Form \{/);
  assert.doesNotMatch(exportView, /Picker\("Scope"/);
  assert.match(exportView, /Toggle\(/);
  assert.match(exportView, /Create Full Backup/);
  assert.match(exportView, /ShareLink/);

  assert.match(restoreView, /Form \{/);
  assert.match(restoreView, /Section\("Export File"\)/);
  assert.match(restoreView, /Choose Export File/);
  assert.match(restoreView, /Section\("Preview"\)/);
  assert.match(restoreView, /Text\(isRestoring \? "Restoring…" : "Restore"\)/);
});

test("iOS Export uses Full Backup wording, timestamp filenames, and diagnostic audit semantics", () => {
  assert.doesNotMatch(dataService, /SettingsExportScope/);
  assert.match(dataService, /leileios-full-backup_/);
  assert.match(dataService, /yyyyMMdd'T'HHmmss'Z'/);
  assert.match(exportView, /Audit and lifecycle events are diagnostic only and are not restored/);
  assert.match(exportView, /Full Backup excludes machine-local working directory paths/);
  assert.match(exportView, /settingsDataErrorMessage\(error\)/);
});

test("iOS restore decodes complete v4 metadata and every portable module", () => {
  for (const token of [
    "schemaVersion",
    "exportedAt",
    "rawBytes",
    "includedModules",
    "auditIncluded",
    "packageSHA256",
    "previewFingerprint",
  ]) {
    assert.match(apiClient, new RegExp(token));
  }

  for (const module of [
    "diaryComments",
    "conversations",
    "mind",
    "universe",
  ]) {
    assert.match(apiClient, new RegExp(module));
    assert.match(dataService, new RegExp(module));
  }

  assert.match(restoreView, /ForEach\(preview\.modules\)/);
  assert.match(restoreView, /Existing data is never overwritten/);
  assert.match(restoreView, /ForEach\(restoreResult\.modules\)/);
  assert.doesNotMatch(restoreView, /outcomeMessage/);
});

test("iOS Summary shows the same portable product modules as Web", () => {
  for (const label of [
    "Diary comments",
    "Todo",
    "Conversations",
    "Mind",
    "Universe",
  ]) {
    assert.match(summaryView, new RegExp(label));
  }

  assert.match(dataService, /diaryComments: summary\.diaryComments\.count/);
  assert.match(dataService, /todo: summary\.todo\.count/);
  assert.match(dataService, /conversationsActive: summary\.conversations\.active/);
  assert.match(dataService, /mind: summary\.mind\.count/);
  assert.match(dataService, /universeNodes: summary\.universe\.nodes/);
});

test("iOS no longer calls retired partial export scopes", () => {
  const files = [
    fs.readFileSync(
      "ios/LeileiOS/LeileiOS/Pages/DiaryView.swift",
      "utf8",
    ),
    ...fs.readdirSync("ios/LeileiOS/LeileiOS/Pages/Diary", { recursive: true })
      .filter((name) => String(name).endsWith(".swift"))
      .map((name) => fs.readFileSync(
        `ios/LeileiOS/LeileiOS/Pages/Diary/${String(name)}`,
        "utf8",
      )),
    fs.readFileSync(
      "ios/LeileiOS/LeileiOS/Pages/UniverseNodeSheet.swift",
      "utf8",
    ),
    ...fs.readdirSync("ios/LeileiOS/LeileiOS/Pages/Universe", { recursive: true })
      .filter((name) => String(name).endsWith(".swift"))
      .map((name) => fs.readFileSync(
        `ios/LeileiOS/LeileiOS/Pages/Universe/${String(name)}`,
        "utf8",
      )),
    fs.readFileSync(
      "ios/LeileiOS/LeileiOS/Pages/DaySpaceView.swift",
      "utf8",
    ),
    ...fs.readdirSync("ios/LeileiOS/LeileiOS/Pages/DaySpace", { recursive: true })
      .filter((name) => String(name).endsWith(".swift"))
      .map((name) => fs.readFileSync(
        `ios/LeileiOS/LeileiOS/Pages/DaySpace/${String(name)}`,
        "utf8",
      )),
  ];

  for (const source of files) {
    assert.doesNotMatch(source, /exportData\s*\(\s*scope\s*:/u);
    assert.doesNotMatch(source, /scope:\s*"(?:diary|todo)"/u);
  }
});
