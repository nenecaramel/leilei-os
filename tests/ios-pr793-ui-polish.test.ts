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

test("ported PR 793 composer polish preserves idle primary-action contrast", () => {
  assert.match(
    composer,
    /ComposerPrimaryActionButtonStyle\([\s\S]*isVisuallyDimmed:[\s\S]*shouldDimPrimaryAction/,
  );
  assert.match(composer, /private var shouldDimPrimaryAction: Bool/);
  assert.match(
    composer,
    /private struct ComposerPrimaryActionButtonStyle: ButtonStyle/,
  );
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
