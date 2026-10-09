import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const navigation = "ios/LeileiOS/LeileiOS/Navigation/";
const read = (name: string) => readFileSync(navigation + name, "utf8");

test("Settings sheet owns navigation only and stays coordinator-sized", () => {
  const source = read("SettingsSheetView.swift");
  assert.ok(source.trimEnd().split("\n").length <= 180);
  assert.match(source, /NavigationStack\(path: \$path\)/);
  assert.match(source, /navigationDestination\(for: SettingsDetailPage.self\)/);
  assert.match(source, /private struct SettingsDetailLayer/);
  assert.doesNotMatch(source, /struct Settings(?:HomeContent|SummaryContent|SectionState)|@AppStorage|func loadSummary|UNUserNotificationCenter/);
  for (const name of ["Summary", "Export", "Restore", "Status", "About"]) {
    assert.match(source, new RegExp(`Settings${name}Content\\(`));
  }
});

test("Settings home retains local appearance notification and auth coordination", () => {
  const home = read("Settings/SettingsHomeContent.swift");
  assert.match(home, /@ObservedObject var appModel: AppModel/);
  assert.match(home, /@AppStorage\("appearanceMode"\) private var appearanceModeRawValue/);
  assert.match(home, /@Environment\(\\.scenePhase\) private var scenePhase/);
  assert.match(home, /\.onChange\(of: scenePhase\)/);
  assert.match(home, /guard newPhase == \.active/);
  assert.match(home, /requestAuthorization\([\s\S]*options: \[\.alert, \.sound, \.badge\]/);
  assert.match(home, /UIApplication.openNotificationSettingsURLString/);
  assert.match(home, /\.confirmationDialog\([\s\S]*"Sign Out\?"/);
  assert.match(home, /try await appModel.signIn\(\)/);
  assert.match(home, /try await appModel.signOut\(\)/);
  assert.match(home, /authErrorMessage = error.localizedDescription/);
  assert.match(home, /\.background\(Color.settingsBackground\)/);
  for (const route of ["summary", "export", "restore", "status", "about"]) {
    assert.match(home, new RegExp(`NavigationLink\\(value: SettingsDetailPage.${route}\\)`));
  }
});

test("Settings summary retains local loading and service request semantics", () => {
  const summary = read("Settings/SettingsSummaryContent.swift");
  assert.match(summary, /@State private var summary: SettingsDataSummary\?/);
  assert.match(summary, /@State private var isLoading = true/);
  assert.match(summary, /\.task \{\s*await loadSummary\(\)/);
  assert.match(summary, /defer \{ isLoading = false \}/);
  assert.match(summary, /summary = try await dataService.readDataSummary\(\)/);
  assert.match(summary, /catch \{\s*summary = nil/);
  assert.match(summary, /isLoading \? "Loading…" : "Unavailable"/);
  assert.match(summary, /\.formStyle\(\.grouped\)/);
});

test("Settings shared presentation and existing detail boundaries stay separate", () => {
  const presentation = read("Settings/SettingsPresentation.swift");
  assert.match(presentation, /struct SettingsSectionState: View/);
  assert.match(presentation, /static let settingsBackground/);
  assert.match(presentation, /minHeight: 44/);
  for (const name of ["About", "Export", "Restore", "Status"]) {
    assert.match(read(`Settings/Settings${name}Content.swift`), new RegExp(`struct Settings${name}Content: View`));
  }
  const sources = [read("SettingsSheetView.swift"), ...readdirSync(navigation + "Settings")
    .filter(name => name.endsWith(".swift"))
    .map(name => read(`Settings/${name}`))];
  for (const source of sources) {
    assert.doesNotMatch(source, /@Observable\b|@StateObject|@Published|:\s*ObservableObject|UserDefaults\.standard|AuthSessionController\(/);
  }
});

const branch = process.env.GITHUB_HEAD_REF
  ?? execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
test("Settings structural branch changes only its iOS presentation and tests", {
  skip: branch !== "refactor/ios-settings-structure",
}, () => {
  const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
  const files = execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const allowed = new Set([
    navigation + "SettingsSheetView.swift",
    ...["HomeContent", "SummaryContent", "Presentation"].map(name => navigation + `Settings/Settings${name}.swift`),
    "tests/ios-settings-boundaries.test.ts",
    "tests/ios-settings-export-restore-v4.test.ts",
  ]);
  for (const file of files) assert.ok(allowed.has(file), `out-of-scope diff: ${file}`);
});
