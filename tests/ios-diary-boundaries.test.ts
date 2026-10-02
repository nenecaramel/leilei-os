import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = "ios/LeileiOS/LeileiOS/Pages/";
function check(path: string, symbols: string[]) {
  assert.ok(fs.existsSync(`${root}Diary/${path}`), `missing ${path}`);
  const source = fs.readFileSync(`${root}Diary/${path}`, "utf8");
  const view = fs.readFileSync(`${root}DiaryView.swift`, "utf8");
  for (const symbol of symbols) {
    assert.match(source, new RegExp(`(?:struct|enum) ${symbol}\\b`));
    assert.doesNotMatch(view, new RegExp(`(?:struct|enum) ${symbol}\\b`));
  }
}

test("Diary models and request envelopes are separate from view composition", () => {
  check("DiaryModels.swift", ["DiaryEntry", "DiaryComment", "DiaryCreateRequest", "DiaryListEnvelope", "DiaryCommentUpdateRequest", "DiaryLoadState"]);
});
test("Diary date helpers have a local independent boundary", () => {
  check("DiaryHelpers.swift", ["DiaryDate", "DiaryCommentDate"]);
});

test("Diary list, filter, archive and reading surfaces have local boundaries", () => {
  check("DiaryListPresentation.swift", ["DiaryNavigationTitle", "DiaryList", "DiaryRow"]);
  check("DiaryDateRangeSheet.swift", ["DiaryCustomDateRangeSheet"]);
  check("Archive/DiaryArchivePresentation.swift", ["DiaryArchiveView", "DiaryArchiveList", "DiaryArchivedDetailView", "DiaryArchivedCommentsSection"]);
  check("DiaryDetailPresentation.swift", ["DiaryDetailView", "DiaryReadingContent", "DiaryMetadataLine", "DiaryCommentsSection"]);
});

test("Diary editor and create surfaces are separate from list composition", () => {
  check("Editors/DiaryEditorPresentation.swift", ["DiaryCommentEditorSheet", "DiaryEditorFields", "DiaryCreateView"]);
  const view = fs.readFileSync(`${root}DiaryView.swift`, "utf8");
  assert.match(view, /struct DiaryView: View/);
  assert.match(view, /@EnvironmentObject private var appModel: AppModel/);
});
