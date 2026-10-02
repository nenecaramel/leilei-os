import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = "ios/LeileiOS/LeileiOS/Pages/";
function check(path: string, symbols: string[]) {
  assert.ok(fs.existsSync(`${root}DaySpace/${path}`), `missing ${path}`);
  const source = fs.readFileSync(`${root}DaySpace/${path}`, "utf8");
  const view = fs.readFileSync(`${root}DaySpaceView.swift`, "utf8");
  for (const symbol of symbols) {
    assert.match(source, new RegExp(`(?:struct|enum|class) ${symbol}\\b`));
    assert.doesNotMatch(view, new RegExp(`(?:struct|enum|class) ${symbol}\\b`));
  }
}

test("Day Space models and transport envelopes are separate from view composition", () => {
  check("DaySpaceModels.swift", ["DaySpaceTodoPaper", "DaySpaceDiary", "DaySpaceTodoSearchEntry", "DaySpaceDiaryUpdateRequest", "DaySpaceModuleState"]);
});
test("Day Space date and hash helpers have an independent boundary", () => {
  check("DaySpaceHelpers.swift", ["DaySpaceDate", "DaySpaceHash"]);
});

test("Day Space reusable presentation and paper detail views have focused boundaries", () => {
  check("DaySpaceChrome.swift", ["DaySpaceDateNavigationRow", "DaySpaceReadingState", "DaySpaceDatePickerSheet"]);
  check("DaySpaceSearch.swift", ["DaySpaceTodoSearchRow"]);
  check("DaySpacePaperCards.swift", ["DaySpaceStage", "DaySpacePaperCard", "DaySpaceTodoPreview", "DaySpaceDiaryPreview"]);
  check("TodoPaper/DaySpaceTodoPaperDetail.swift", ["DaySpaceTodoPaperDetail"]);
  check("DiaryPaper/DaySpaceDiaryPaperDetail.swift", ["DaySpaceDiaryPaperDetail"]);
});

test("Day Space UIKit editors preserve existing concrete bridges in editor modules", () => {
  check("Editors/DaySpaceTodoEditor.swift", ["DaySpaceTodoLineEditor", "DaySpaceTodoNativeTextView"]);
  check("Editors/DaySpaceDiaryEditor.swift", ["DaySpaceDiaryBodyEditor"]);
  const todo = fs.readFileSync(`${root}DaySpace/Editors/DaySpaceTodoEditor.swift`, "utf8");
  assert.match(todo, /UIViewRepresentable/);
  assert.match(todo, /func updateUIView/);
  assert.match(todo, /class Coordinator/);
});

test("Day Space geometry and detail layering are separated from feature view state", () => {
  check("Layout/DaySpaceLayout.swift", ["DaySpaceLayout", "DaySpaceLayoutItem", "DaySpacePaperSize"]);
  check("Layout/DaySpacePaperDetailLayer.swift", ["DaySpacePaperDetailLayer"]);
  const view = fs.readFileSync(`${root}DaySpaceView.swift`, "utf8");
  assert.match(view, /struct DaySpaceView: View/);
  assert.match(view, /@EnvironmentObject private var appModel: AppModel/);
});
