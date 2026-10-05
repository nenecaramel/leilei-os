import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composer = readFileSync(
  "ios/LeileiOS/LeileiOS/Chat/ChatComposer.swift",
  "utf8",
);
const usage = readFileSync(
  "ios/LeileiOS/LeileiOS/Navigation/ClaudeUsageSheet.swift",
  "utf8",
);
const pageContainer = readFileSync(
  "ios/LeileiOS/LeileiOS/Navigation/PageContainer.swift",
  "utf8",
);
const projects = readFileSync(
  "ios/LeileiOS/LeileiOS/Pages/ProjectsView.swift",
  "utf8",
);
const runtimeStore = readFileSync(
  "ios/LeileiOS/LeileiOS/App/NativeLiveRuntimeStore.swift",
  "utf8",
);

test("ported PR 793 composer polish preserves idle primary-action contrast", () => {
  const presentation = readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/ComposerPresentationComponents.swift",
    "utf8",
  );
  assert.match(
    composer,
    /ComposerPrimaryActionButtonStyle\([\s\S]*isVisuallyDimmed:[\s\S]*actionPresentation\.isDimmed/,
  );
  assert.match(presentation, /struct ComposerPrimaryActionButtonStyle: ButtonStyle/);
  assert.match(presentation, /@Environment\(\\\.isEnabled\)/);
  assert.match(presentation, /isVisuallyDimmed\s*\? 0\.35/);
  assert.match(presentation, /configuration\.isPressed\s*&& isEnabled\s*\? 0\.72\s*: 1/);
});

test("ported PR 793 Claude Usage uses the Settings surface background", () => {
  assert.match(usage, /\.formStyle\(\.grouped\)/);
  assert.match(usage, /\.scrollContentBackground\(\.hidden\)/);
  assert.match(usage, /\.background\(Color\.settingsBackground\)/);
});

test("ported PR 793 conversation menu uses concise fork label and red delete affordance", () => {
  assert.match(pageContainer, /"Fork Session"/);
  assert.doesNotMatch(pageContainer, /"Fork Claude Session"/);
  assert.match(
    pageContainer,
    /Button\(role: \.destructive\)[\s\S]*Text\("Delete"\)[\s\S]*foregroundStyle\(\.red\)[\s\S]*destructiveTrashIcon/,
  );
  assert.match(
    pageContainer,
    /UIImage\(systemName: "trash"\)\?[\s\S]*withTintColor\([\s\S]*\.systemRed,[\s\S]*renderingMode: \.alwaysOriginal/,
  );
});

test("ported PR 793 Context puts Manual Compact before dense Session Environment blocks", () => {
  const manualIndex = projects.indexOf('Section("Manual Compact")');
  const environmentIndex = projects.indexOf('Section("Session Environment")');
  assert.ok(manualIndex >= 0);
  assert.ok(environmentIndex >= 0);
  assert.ok(manualIndex < environmentIndex);

  assert.match(
    projects,
    /environmentBlockRow\(\s*"Working Directory"/,
  );
  assert.match(projects, /environmentBlockRow\(\s*"MCP"/);
  assert.match(projects, /environmentBlockRow\(\s*"Plugins"/);
  assert.match(projects, /environmentBlockRow\(\s*"Plugin Errors"/);
  assert.match(
    projects,
    /normalizedValues\.joined\(separator: " · "\)/,
  );
});


test("Context keeps a Session Environment skeleton until metadata fetch succeeds", () => {
  assert.match(
    projects,
    /@State private var hasLoadedRuntimeMetadata = false/,
  );
  assert.match(
    projects,
    /else if !hasLoadedRuntimeMetadata \{\s*Section\("Session Environment"\)[\s\S]*"Runtime Model"[\s\S]*"Working Directory"[\s\S]*"Permission"[\s\S]*"Claude Code"[\s\S]*"Agent SDK"/,
  );
  assert.match(
    projects,
    /hasLoadedRuntimeMetadata =\s*await appModel\.refreshActiveNativeLiveRuntimeMetadata\(\)/,
  );
  assert.match(
    runtimeStore,
    /@discardableResult\s*func refreshActiveNativeLiveRuntimeMetadata\(\) async -> Bool/,
  );
  assert.match(runtimeStore, /return true[\s\S]*catch LeileiAPIError\.missingAccessToken/);
  assert.match(runtimeStore, /catch \{[\s\S]*return false[\s\S]*\}/);
});
