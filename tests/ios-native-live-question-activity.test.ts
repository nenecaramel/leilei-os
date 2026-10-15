import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
const surface = "ios/LeileiOS/LeileiOS/Chat/MessageSurface/";
test("real Swift Activity projection keeps one durable question across runtime retention and task hierarchy", { skip: process.platform !== "darwin" }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "leilei-question-swift-"));
  try {
    const runtime = fs.readFileSync(surface + "NativeLiveToolActivity.swift", "utf8");
    const state = runtime.slice(runtime.indexOf("enum NativeLiveToolCallState:"), runtime.indexOf("struct NativeLiveToolCallCard:"));
    fs.writeFileSync(path.join(temporary, "State.swift"), state);
    fs.copyFileSync("tests/fixtures/native-live-question-activity.swift", path.join(temporary, "main.swift"));
    const projections = fs.readdirSync(surface).filter((name) => name.startsWith("NativeLiveTurnActivityProjection") && name.endsWith(".swift")).map((name) => surface + name);
    const compiled = spawnSync("xcrun", ["swiftc", "-module-cache-path", path.join(temporary, "cache"), "ios/LeileiOS/LeileiOS/Infrastructure/NativeLiveRuntimeModels.swift", "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveModels.swift", ...projections, path.join(temporary, "State.swift"), path.join(temporary, "main.swift"), "-o", path.join(temporary, "check")], { encoding: "utf8", timeout: 120_000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    const ran = spawnSync(path.join(temporary, "check"), [], { encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /Question activity behavior passed/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
test("question presentation preserves the interactive card and uses Question / Response historical details", () => {
  const source = fs.readFileSync(surface + "NativeLiveRuntimeInteractions.swift", "utf8");
  assert.match(source, /struct NativeLiveQuestionActivityRow/);
  assert.match(source, /NativeLiveQuestionInteractionCard/);
  assert.match(source, /Text\("Asked user"\)/);
  assert.match(source, /sectionTitle: "Question"/);
  assert.match(source, /secondarySectionTitle: "Response"/);
});


test("pending permission and question cards share wallpaper-only native glass without changing their actions", () => {
  const source = fs.readFileSync(surface + "NativeLiveInteractions.swift", "utf8");
  const originalPanel = source.slice(
    source.indexOf("private struct NativeLiveInteractionCardBackground: ViewModifier"),
    source.indexOf("struct NativeLivePermissionInteractionCard: View")
  );
  const permission = source.slice(
    source.indexOf("struct NativeLivePermissionInteractionCard: View"),
    source.indexOf("struct NativeLiveQuestionInteractionCard: View")
  );
  const question = source.slice(source.indexOf("struct NativeLiveQuestionInteractionCard: View"));

  // Wallpaper-backed iMessage gets the same 11pt regular glass as Tool rows.
  assert.match(originalPanel, /@Environment\(\\\.iMessageWallpaperVisible\) private var iMessageWallpaperVisible/);
  assert.match(originalPanel, /if iMessageWallpaperVisible \{/);
  assert.match(originalPanel, /\.glassEffect\(\s*\.regular,\s*in: RoundedRectangle\(cornerRadius: 11, style: \.continuous\)/);
  assert.match(originalPanel, /\.foregroundStyle\(Color\(red: 0\.17, green: 0\.20, blue: 0\.23\)\)/);
  // Without the wallpaper, Original and plain iMessage keep their old paint.
  assert.match(originalPanel, /else \{\s*content\.background\(\s*Color\.primary\.opacity\(0\.055\),\s*in: RoundedRectangle\(cornerRadius: 14, style: \.continuous\)/);
  for (const card of [permission, question]) {
    assert.match(card, /\.padding\(14\)\s*\.modifier\(NativeLiveInteractionCardBackground\(\)\)/);
    assert.doesNotMatch(card, /\.background\(\s*Color\.primary\.opacity\(0\.055\)/);
    assert.match(card, /\.disabled\(isSubmitting\)/);
    assert.match(card, /try await onResolve\(/);
    assert.match(card, /errorMessage = error\.localizedDescription/);
  }
  assert.match(permission, /Button\("Deny", role: \.destructive\)/);
  assert.match(permission, /Button\("Allow"\)/);
  assert.match(question, /selectedOptions\[question\.text\] = \[option\]/);
  assert.match(question, /TextField\(/);
  assert.match(question, /Button\("Cancel"\)/);
  assert.match(question, /Button\("Submit"\)/);
  assert.match(question, /"answers": \.object\(answers\)/);
});


test("wallpaper iMessage task subrows share Tool-list glass while non-wallpaper layouts and actions remain unchanged", () => {
  const task = fs.readFileSync(surface + "NativeLiveTaskActivity.swift", "utf8");
  const history = fs.readFileSync(surface + "NativeLiveRuntimeInteractions.swift", "utf8");
  const activity = fs.readFileSync(surface + "NativeLiveRuntimeActivity.swift", "utf8");
  const tool = fs.readFileSync(surface + "NativeLiveToolActivity.swift", "utf8");

  // One 11pt Regular Liquid Glass treatment, matching Tool rows.
  assert.match(task, /struct NativeLiveActivityGlassRow: ViewModifier/);
  assert.match(task, /@Environment\(\\\.iMessageWallpaperVisible\) private var iMessageWallpaperVisible/);
  assert.match(task, /if iMessageWallpaperVisible \{\s*content\s*\.padding\(\.horizontal, 11\)\s*\.padding\(\.vertical, 9\)/);
  assert.match(task, /\.glassEffect\(\s*\.regular,\s*in: RoundedRectangle\(cornerRadius: 11, style: \.continuous\)/);
  assert.match(task, /else \{\s*content\s*\}/);
  assert.match(tool, /\.glassEffect\(\s*\.regular,\s*in: RoundedRectangle\(cornerRadius: 11, style: \.continuous\)/);

  // Exactly three surfaces in the task file: lifecycle, parent task header,
  // and Resources. Do not wrap the whole VStack and nested child controls.
  assert.equal((task.match(/\.modifier\(NativeLiveActivityGlassRow\(\)\)/g) ?? []).length, 3);
  const taskArea = task.slice(task.indexOf("struct NativeLiveTaskActivityRow:"), task.indexOf("struct NativeLiveTaskResourceRow:"));
  assert.match(taskArea, /\.modifier\(NativeLiveActivityGlassRow\(\)\)\s*ForEach\(childTools\)/);
  assert.match(taskArea, /NativeLiveToolActivityRow\(/);
  assert.match(taskArea, /NativeLiveQuestionActivityRow\(/);
  assert.match(taskArea, /NativeLiveTaskResourceRow\(/);
  assert.match(task, /\.padding\(\.horizontal, iMessageWallpaperVisible \? 0 : 5\)/);

  // Asked user and resolved permission history get their own row glass.
  // The pending answer form stays its separate glass card.
  assert.equal((history.match(/\.modifier\(NativeLiveActivityGlassRow\(\)\)/g) ?? []).length, 2);
  assert.match(history, /NativeLiveQuestionInteractionCard\(/);
  assert.match(history, /\.padding\(\.horizontal, iMessageWallpaperVisible \? 0 : 5\)/);
  assert.match(history, /isShowingDetails = true/);
  assert.match(history, /NativeLiveToolDetailSheet\(/);
  assert.match(activity, /NativeLiveLifecycleActivityRow\(/);

  // All textual levels match the Tool-list charcoal palette, while Original
  // retains hierarchical primary/secondary/tertiary text.
  for (const kind of ["primary", "secondary", "tertiary"]) {
    assert.ok(task.includes("static func " + kind + "(_ enabled: Bool)"), kind);
    assert.ok(task.includes("HierarchicalShapeStyle." + kind), kind);
  }
  assert.match(task, /Color\(red: 0\.17, green: 0\.20, blue: 0\.23\)/);
  assert.match(task, /Color\.black\.opacity\(0\.64\)/);
  assert.match(task, /Color\.black\.opacity\(0\.48\)/);
  for (const item of [task, history]) {
    assert.match(item, /NativeLiveActivityGlassText\.primary\(iMessageWallpaperVisible\)/);
    assert.match(item, /NativeLiveActivityGlassText\.secondary\(iMessageWallpaperVisible\)/);
    assert.match(item, /NativeLiveActivityGlassText\.tertiary\(iMessageWallpaperVisible\)/);
  }
  assert.match(task, /if iMessageWallpaperVisible \{\s*ProgressView\(\)\s*\.controlSize\(\.mini\)\s*\.tint\(NativeLiveActivityGlassText\.primaryColor\)/);
  // Preserve existing depth nesting and original resource/detail actions.
  assert.match(task, /min\(max\(task\.spawnDepth \?\? 0, 0\), 4\)/);
  assert.match(task, /isShowingResources = true/);
});
