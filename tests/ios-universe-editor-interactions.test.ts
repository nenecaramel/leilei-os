import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../ios/LeileiOS/LeileiOS/Pages/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("Universe node edit protects dirty drafts", () => {
  const sheet = read("UniverseNodeSheet.swift");
  const actions = read("Universe/Nodes/UniverseNodeCoordination.swift");
  const toolbar = read("Universe/Nodes/UniverseNodeToolbar.swift");
  assert.match(sheet, /@State var originalDraft: UniverseNodeDraft/);
  assert.match(sheet, /interactiveDismissDisabled\(isEditing \|\| isSaving\)/);
  assert.match(actions, /draft != originalDraft/);
  assert.match(actions, /confirmation = \.discardChanges/);
  assert.match(actions, /\(isCreate \|\| hasUnsavedChanges\)/);
  assert.match(actions, /let submittedDraft = draft/);
  assert.match(toolbar, /Button \{\s*cancel\(\)/);
  assert.match(toolbar, /\.disabled\(!canSave\)/);
});

test("Universe destructive node and relation actions require confirmation", () => {
  const sheet = read("UniverseNodeSheet.swift");
  const detail = read("Universe/Nodes/UniverseNodeDetail.swift");
  const toolbar = read("Universe/Nodes/UniverseNodeToolbar.swift");
  assert.match(sheet, /case \.deleteNode:[\s\S]*Button\("Delete", role: \.destructive\)/);
  assert.match(sheet, /case \.restoreVersion:[\s\S]*Button\("Restore", role: \.destructive\)/);
  assert.match(detail, /confirmation = \.removeConnection\(connection\.relation\)/);
  assert.match(toolbar, /confirmation = \.deleteNode/);
  assert.match(toolbar, /confirmation = \.restoreVersion/);
});

test("Universe nested sheets protect selection and connection drafts", () => {
  const picker = read("Universe/Nodes/UniverseSourcePicker.swift");
  const relation = read("Universe/Nodes/UniverseRelationSheet.swift");
  assert.match(picker, /cancelSelection\(\)/);
  assert.match(picker, /interactiveDismissDisabled\(hasUnsavedChanges\)/);
  assert.match(picker, /let ordered = retained \+ added/);
  assert.match(relation, /interactiveDismissDisabled\(isSaving \|\| hasUnsavedChanges\)/);
  assert.match(relation, /guard !isSaving, !targetID\.isEmpty/);
});

test("Universe import preview can be cancelled without importing", () => {
  assert.match(read("Universe/UniversePagePresentation.swift"), /discardImportSelection\(\)/);
  assert.match(read("Universe/UniversePageIO.swift"), /func discardImportSelection\(\)/);
});
