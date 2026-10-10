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
  assert.doesNotMatch(toolbar, /restoreVersion|Restore Previous Version/);
  const menu = toolbar.slice(toolbar.indexOf("Menu {"));
  assert.match(menu, /Button\("Add Connection"\) \{\s*relationPresented = true/);
  assert.match(menu, /Button\("Edit"\) \{\s*resetDraft\(\)\s*isEditing = true/);
  assert.match(menu, /Button\("Delete", role: \.destructive\) \{\s*confirmation = \.deleteNode/);
  assert.doesNotMatch(menu.split("} label: {")[0], /Label\(|Image\(/);
  assert.doesNotMatch(toolbar.slice(toolbar.indexOf("} else if node != nil {"), toolbar.indexOf("Menu {")), /Button/);
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


test("Universe creation uses a drawer while node detail stays fullscreen", () => {
  const page = read("UniverseView.swift");
  const navigation = read("Universe/UniverseNodeNavigation.swift");
  assert.match(page, /fullScreenCover\(\s*item: nodeDetailSelection/);
  assert.match(page, /\.sheet\(item: nodeCreateSelection\)/);
  assert.match(navigation, /case \.node = sheetSelection/);
  assert.match(navigation, /case \.create = sheetSelection/);
  assert.match(page, /presentationDetents\(\[\.large\]\)/);
  assert.match(page, /presentationDragIndicator\(\.visible\)/);
});

test("Universe editing overlays stable detail and owns its nested presentations", () => {
  const sheet = read("UniverseNodeSheet.swift");
  const toolbar = read("Universe/Nodes/UniverseNodeToolbar.swift");
  assert.match(sheet, /nodePresentation\(editing: false\)[\s\S]*\.sheet\(isPresented: \$isEditing\)/);
  assert.match(sheet, /nodePresentation\(editing: true\)[\s\S]*presentationDetents\(\[\.large\]\)/);
  assert.match(sheet, /editing == isEditing && confirmation != nil/);
  assert.match(sheet, /editing && sourcePickerPresented/);
  assert.match(sheet, /toolbarContent\(editing: editing\)/);
  assert.match(toolbar, /if editing/);
  const actions = read("Universe/Nodes/UniverseNodeCoordination.swift");
  assert.match(actions, /if isCreate \{\s*onClose\(\)\s*\} else \{/);
  assert.match(actions, /originalDraft = submittedDraft\s*isEditing = false/);
});

test("Universe home keeps only Add in the trailing toolbar", () => {
  const source = read("Universe/UniversePagePresentation.swift");
  const toolbar = source.slice(source.indexOf("func readyToolbar("));
  assert.doesNotMatch(toolbar, /Menu \{|Picker\(|prepareExport|Export Universe|ellipsis/);
  assert.match(toolbar, /"Add Node"/);
  assert.match(toolbar, /mapMode = \.placingNode/);
  assert.match(toolbar, /mapMode = \.browse/);
});

test("Universe galaxy selector shares the map control row and native button style", () => {
  const map = read("UniverseMapView.swift");
  const controls = read("Universe/Map/UniverseMapPresentation.swift");
  assert.match(map, /@Binding var activeGalaxyID: String\?/);
  assert.match(map, /HStack \{\s*galaxyMenu\s*Spacer\(\)[\s\S]*Text\("View All"\)/);
  assert.match(map, /\.padding\(16\)\s*\.padding\(\.top, controlsTopInset\)/);
  assert.match(controls, /Picker\("", selection: \$activeGalaxyID\)/);
  assert.match(controls, /pickerStyle\(\.inline\)/);
  assert.match(controls, /\.buttonStyle\(\.bordered\)\s*\.controlSize\(\.small\)/);
  assert.match(controls, /onOpenGalaxyMenu\(\)/);
});

test("Universe centers its title and extends only the map beneath floating navigation", () => {
  const container = readFileSync(new URL("../ios/LeileiOS/LeileiOS/Navigation/PageContainer.swift", import.meta.url), "utf8");
  assert.match(container, /if selectedPage == \.universe \{\s*ToolbarItem\(placement: \.principal\)/);
  assert.match(container, /toolbarBackground\(\.hidden, for: \.navigationBar\)/);
  const page = read("Universe/UniversePagePresentation.swift");
  assert.match(page, /activeGalaxyID: \$activeGalaxyID/);
  assert.match(page, /controlsTopInset: proxy.safeAreaInsets.top/);
  assert.match(page, /onOpenGalaxyMenu: cancelPlacementForToolbarMenu/);
  assert.match(page, /\.ignoresSafeArea\(\.container, edges: \.top\)/);
});
