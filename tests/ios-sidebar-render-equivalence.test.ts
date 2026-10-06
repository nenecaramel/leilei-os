import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const navigation = "ios/LeileiOS/LeileiOS/Navigation/";
const baseline = "tests/fixtures/sidebar-main-71904b00/";
function mark(source: string, pattern: RegExp, frame: string) {
  assert.equal([...source.matchAll(new RegExp(pattern.source, "g"))].length, 1, `measurement anchor: ${frame}`);
  return source.replace(pattern, `$&\n.testSidebarFrame("${frame}")`);
}
// Measurement backgrounds exist only in generated test sources. They paint
// nothing and do not participate in layout; production has no test hooks.
function measured(source: string, section: boolean) {
  if (section) {
    source = mark(source, /\.frame\(width: 18, alignment: \.center\)/, "nav.icon.\\(page.id)");
    source = mark(source, /\.font\(\.system\(size: 17\.5, weight: \.regular\)\)/, "nav.text.\\(page.id)");
    source = mark(source, /\.contentShape\(Rectangle\(\)\)/, "nav.row.\\(page.id)");
  } else {
    source = mark(source, /\.font\(\.system\(size: 22, weight: \.regular\)\)/, "title");
    source = mark(source, /\.font\(\.system\(size: 14\.5, weight: \.medium\)\)/, "recents");
    source = mark(source, /\.lineLimit\(1\)/, "conversation.text.\\(conversation.id)");
    source = mark(source, /\.font\(\.system\(\n\s*size: 14\.5,\s*weight: \.medium\s*\)\)/, "viewAll.text");
    let row = 0;
    source = source.replace(/\.contentShape\(Rectangle\(\)\)/g, match => `${match}\n.testSidebarFrame("${row++ === 0 ? "conversation.row.\\(conversation.id)" : "viewAll.row"}")`);
    assert.equal(row, 2);
  }
  return source.replace(/\.fill\(\.primary\.opacity\(0\.05\)\)/g, '$&\n.testSidebarFrame("selection")');
}
function renamed(source: string, prefix: string) {
  return source.replace(/\b(SidebarView|SidebarSection|FloatingGlassButton|FloatingUIKitGlassButton|sidebarSystemImage)\b/g, name => prefix + name);
}
// Reconstruct the previous rejected UI-1 gutter patch as a real renderable
// negative control, rather than simulating a failure inside the comparator.
function rejectedGutter(view: string, section: string) {
  view = view.replace('.padding(.top, 18)\n                            .offset(x: titleHorizontalOffset - 5, y: 20)', '.padding(.top, 32)\n                            .padding(.leading, 12)')
    .replace('textLeadingOffset: titleHorizontalOffset - navigationRowHorizontalInset,\n                                selectedBackgroundLeadingOffset: titleHorizontalOffset - 16,', 'textLeadingOffset: 0,\n                                selectedBackgroundLeadingOffset: 0,')
    .replace('.padding(.horizontal, 22)', '.padding(.horizontal, 16)')
    .replace(/\s*\.offset\(y: (9|7)\)/g, '')
    .replace('.padding(.horizontal, 10)\n                .offset(x: titleHorizontalOffset - 14, y: 2)', '.padding(.horizontal, 12)')
    .replace(/\s*\.offset\(\s*x: titleHorizontalOffset - navigationRowHorizontalInset,\s*y: 2\s*\)/g, '')
    .replace(/\s*\.padding\(\s*\.leading,\s*titleHorizontalOffset - 16\s*\)\s*\.padding\(\.trailing, 3\)\s*\.offset\(y: 2\)/g, '')
    .replace(/\.padding\(\.horizontal, 10\)\s*\.offset\(\s*x: titleHorizontalOffset - 14,\s*y: 2\s*\)/g, '.padding(.horizontal, 12)');
  section = section.replace('.offset(x: textLeadingOffset, y: 2)', '')
    .replace(/\s*\.padding\(\.leading, selectedBackgroundLeadingOffset\)\s*\.padding\(\.trailing, 3\)\s*\.offset\(y: 2\)/g, '');
  return [view, section];
}

test("Sidebar renders identically to pinned main; rejects the former unified gutter layout", {
  skip: process.platform !== "darwin" || !process.env.UI_TOKEN_SIMULATOR_ID
    ? "Requires macOS and UI_TOKEN_SIMULATOR_ID pointing to a booted simulator"
    : false,
}, () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "leilei-sidebar-equivalence-"));
  const simulator = process.env.UI_TOKEN_SIMULATOR_ID;
  try {
    const sources: string[] = [];
    const originalView = readFileSync(baseline + "SidebarView.swift", "utf8").replace(/\s*\.workspaces,/g, "");
    const originalSection = readFileSync(baseline + "SidebarSection.swift", "utf8").replace(/        case \.workspaces:\n            return "folder"\n/g, "");
    const bad = rejectedGutter(originalView, originalSection);
    for (const [prefix, view, section] of [
      ["Baseline", originalView, originalSection], ["Rejected", bad[0], bad[1]],
      ["", readFileSync(navigation + "SidebarView.swift", "utf8"), readFileSync(navigation + "SidebarSection.swift", "utf8")],
    ]) {
      for (const [name, source, isSection] of [["View", view, false], ["Section", section, true]] as const) {
        const target = path.join(temporary, prefix + name + ".swift");
        writeFileSync(target, renamed(measured(source, isSection), prefix));
        sources.push(target);
      }
    }
    const layout = navigation + "SidebarLayout.swift";
    if (existsSync(layout)) {
      const target = path.join(temporary, "Layout.swift");
      writeFileSync(target, readFileSync(layout, "utf8").replace(/\.fill\(\.primary\.opacity\(0\.05\)\)/g, '$&\n.testSidebarFrame("selection")'));
      sources.push(target);
    }
    const models = readFileSync("ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveModels.swift", "utf8");
    const model = path.join(temporary, "Summary.swift");
    writeFileSync(model, models.slice(0, models.indexOf("struct NativeLiveConversationPage:")));
    const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], { encoding: "utf8" });
    assert.equal(sdk.status, 0, sdk.stderr);
    const app = path.join(temporary, "Checks.app"); mkdirSync(app);
    writeFileSync(path.join(app, "Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict>
      <key>CFBundleIdentifier</key><string>com.leileios.tests.sidebar-equivalence</string>
      <key>CFBundleExecutable</key><string>Checks</string><key>CFBundlePackageType</key><string>APPL</string>
      <key>CFBundleName</key><string>Checks</string><key>CFBundleVersion</key><string>1</string>
      <key>CFBundleShortVersionString</key><string>1.0</string><key>LSRequiresIPhoneOS</key><true/>
      <key>UIApplicationSceneManifest</key><dict><key>UIApplicationSupportsMultipleScenes</key><false/><key>UISceneConfigurations</key><dict/></dict>
      <key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array></dict></plist>`);
    const compiled = spawnSync("xcrun", ["swiftc", "-sdk", sdk.stdout.trim(),
      "-target", `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-ios26.0-simulator`, "-parse-as-library",
      "-module-cache-path", path.join(temporary, "cache"),
      ...(process.env.UI_SIDEBAR_REJECTED_AS_CURRENT ? ["-D", "REJECTED_AS_CURRENT"] : []),
      "ios/LeileiOS/LeileiOS/DesignSystem/LeileiUITokens.swift", navigation + "AppPage.swift",
      ...sources, model, "tests/fixtures/ios-sidebar-render-equivalence.swift", "-o", path.join(app, "Checks"),
    ], { encoding: "utf8", timeout: 120_000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    if (simulator) {
      const installed = spawnSync("xcrun", ["simctl", "install", simulator, app], { encoding: "utf8" });
      assert.equal(installed.status, 0, installed.stderr);
      const checked = spawnSync("xcrun", ["simctl", "launch", "--console", "--terminate-running-process", simulator, "com.leileios.tests.sidebar-equivalence"], { encoding: "utf8", timeout: 120_000 });
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      assert.match(checked.stdout + checked.stderr, /Sidebar render equivalence PASS/);
      console.info(checked.stdout.trim());
    }
  } finally {
    if (simulator) spawnSync("xcrun", ["simctl", "uninstall", simulator, "com.leileios.tests.sidebar-equivalence"], { encoding: "utf8" });
    rmSync(temporary, { recursive: true, force: true });
  }
});
