import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = "ios/LeileiOS/LeileiOS/Pages/";
function read(path: string) {
  assert.ok(fs.existsSync(`${root}Universe/${path}`), `missing ${path}`);
  return fs.readFileSync(`${root}Universe/${path}`, "utf8");
}

test("Universe drafts and view-state models have a feature model boundary", () => {
  const models = read("UniverseViewModels.swift");
  for (const symbol of ["UniverseNodeDraft", "UniverseMapMode", "UniversePageState", "UniverseSheetSelection"]) {
    assert.match(models, new RegExp(`(?:struct|enum) ${symbol}\\b`));
  }
  for (const file of ["UniverseView.swift", "UniverseMapView.swift", "UniverseNodeSheet.swift"]) {
    assert.doesNotMatch(fs.readFileSync(`${root}${file}`, "utf8"), /(?:struct|enum) (?:UniverseNodeDraft|UniverseMapMode|UniversePageState|UniverseSheetSelection)\b/);
  }
});

test("Universe source/relation sheets and map rendering have focused view boundaries", () => {
  assert.match(read("Nodes/UniverseSourcePicker.swift"), /struct UniverseDiarySourcePicker/);
  assert.match(read("Nodes/UniverseRelationSheet.swift"), /struct UniverseRelationSheet/);
  assert.match(read("Map/UniverseMapCanvas.swift"), /struct UniverseMapCanvas/);
  assert.match(read("Map/UniversePlanet.swift"), /struct UniversePlanet/);
  assert.match(read("Map/UniversePalette.swift"), /enum UniversePalette/);
  assert.doesNotMatch(fs.readFileSync(`${root}UniverseMapView.swift`, "utf8"), /struct UniverseMapCanvas|struct UniversePlanet|enum UniversePalette/);
});

test("Universe node and page presentation are composed from existing view members", () => {
  assert.match(read("Nodes/UniverseNodeEditor.swift"), /extension UniverseNodeSheet[\s\S]*var editor:/);
  assert.match(read("Nodes/UniverseNodeDetail.swift"), /func detail\(/);
  assert.match(read("Nodes/UniverseNodeToolbar.swift"), /var toolbarContent:/);
  assert.match(read("UniversePagePresentation.swift"), /extension UniverseView[\s\S]*func universeReady\(/);
  assert.match(read("UniverseNodeNavigation.swift"), /func nodeSheet\(/);
  assert.match(read("Map/UniverseMapPresentation.swift"), /extension UniverseMapView[\s\S]*func planet\(/);
});

test("Universe page import/export and node editing coordination preserve one view-state owner", () => {
  assert.match(read("Editors/UniverseJSONDocument.swift"), /struct UniverseJSONDocument/);
  assert.match(read("UniversePageIO.swift"), /extension UniverseView[\s\S]*func handleImportedFile\(/);
  assert.match(read("UniversePageMutations.swift"), /func saveNode\(/);
  assert.match(read("UniversePageCoordination.swift"), /func load\(/);
  assert.match(read("Nodes/UniverseNodeCoordination.swift"), /extension UniverseNodeSheet[\s\S]*func save\(/);
  for (const file of ["UniversePageIO.swift", "UniversePageMutations.swift", "UniversePageCoordination.swift", "Nodes/UniverseNodeCoordination.swift"]) {
    assert.doesNotMatch(read(file), /@State |@Published|class \w+: ObservableObject/);
  }
});

test("Universe geometry and viewport gestures have local layout boundaries", () => {
  assert.match(read("Layout/UniverseFlowLayout.swift"), /struct FlowLayout/);
  assert.match(read("Map/UniverseMapGeometry.swift"), /extension UniverseMapView[\s\S]*func fitViewport\(/);
  assert.match(read("Map/UniverseMapGestures.swift"), /func mapDragGesture\(/);
  assert.match(read("Map/UniverseMapGestures.swift"), /func magnificationGesture\(/);
  for (const [file, symbol] of [["UniverseView.swift", "UniverseView"], ["UniverseNodeSheet.swift", "UniverseNodeSheet"], ["UniverseMapView.swift", "UniverseMapView"]]) {
    const source = fs.readFileSync(`${root}${file}`, "utf8");
    assert.match(source, new RegExp(`struct ${symbol}: View`));
    assert.match(source, /@State /);
    assert.match(source, /var body: some View/);
  }
  assert.match(read("Map/UniverseMapGeometry.swift"), /UserDefaults\.standard/);
  assert.match(fs.readFileSync(`${root}UniverseMapView.swift`, "utf8"), /"universe\.native\.viewport\.v1"/);
});
