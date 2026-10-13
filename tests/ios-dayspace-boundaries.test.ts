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
  check("Editors/DaySpacePaperBodyEditor.swift", ["DaySpacePaperBodyEditor"]);
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

test("Day Space root retains all feature state and real async coordination", () => {
  const view = fs.readFileSync(`${root}DaySpaceView.swift`, "utf8");
  assert.ok(view.trimEnd().split("\n").length <= 650, "reduce presentation without displacing legitimate coordination");
  for (const state of ["query", "searchState", "completeTodoSearch", "searchHasMore", "isLoadingMoreSearch", "selectedDate", "discoveryState", "discoveryIncomplete", "todoState", "diaryState", "selection", "createSelection", "datePickerPresented", "datePickerDraft", "generation"]) {
    assert.match(view, new RegExp(`@State private var ${state}\\b`));
  }
  for (const method of ["openExternalTarget", "searchTodoIfNeeded", "loadMoreTodoSearch", "openSearchResult", "discoverAndLoad", "readDates", "loadDate", "retryTodo", "retryDiary", "readTodo", "readDiaries", "refreshTodoAfterSave", "refreshDiaryAfterSave", "applyTodo", "applyDiary"]) {
    assert.match(view, new RegExp(`private func ${method}\\b`));
  }
  assert.match(view, /\.task\(id: target\)/);
  assert.match(view, /\.task\(id: query\)/);
  assert.match(view, /Task\.sleep\(for: \.milliseconds\(250\)\)/);
  assert.match(view, /requestGeneration == generation/);
});

test("Day Space search and main content presentation are focused and stateless", () => {
  check("DaySpaceSearch.swift", ["DaySpaceSearchContent"]);
  check("DaySpaceContent.swift", ["DaySpaceContent"]);
  for (const file of ["DaySpaceSearch.swift", "DaySpaceContent.swift", "DaySpaceTodoSearchSupport.swift"]) {
    const source = fs.readFileSync(`${root}DaySpace/${file}`, "utf8");
    assert.ok(source.trimEnd().split("\n").length <= 350);
    assert.doesNotMatch(source, /ObservableObject|@Observable\b|@StateObject|@ObservedObject|@Published|@State\b|UserDefaults|@AppStorage|Task\s*\{|appModel|\.api\.|exportData\(/);
  }
  const content = fs.readFileSync(`${root}DaySpace/DaySpaceContent.swift`, "utf8");
  assert.match(content, /todoState.isErrorWithoutValue && diaryState.isErrorWithoutValue/);
  assert.match(content, /\(todoState.isLoading \|\| diaryState.isLoading \|\| memoryLoading\) && papers.isEmpty/);
  assert.match(content, /DaySpacePartialFailure\(/);
  assert.match(content, /DaySpaceStage\(/);
  const search = fs.readFileSync(`${root}DaySpace/DaySpaceSearch.swift`, "utf8");
  assert.match(search, /if searchHasMore/);
  assert.match(search, /\.disabled\(isLoadingMoreSearch\)/);
  assert.match(search, /case \.noResults:/);
  assert.match(search, /case \.unavailable:/);
});

test("Pure Todo search ranking and path construction have a stateless boundary", () => {
  check("DaySpaceTodoSearchSupport.swift", ["DaySpaceTodoSearchSupport"]);
  const view = fs.readFileSync(`${root}DaySpaceView.swift`, "utf8");
  assert.doesNotMatch(view, /private func (?:completeTodoSearchResults|normalizedTodoSearchText|todoSearchPath)\b/);
  assert.match(view, /DaySpaceTodoSearchSupport.completeTodoSearchResults\(/);
  assert.match(view, /DaySpaceTodoSearchSupport.todoSearchPath\(/);
  const support = fs.readFileSync(`${root}DaySpace/DaySpaceTodoSearchSupport.swift`, "utf8");
  assert.match(support, /\.precomposedStringWithCanonicalMapping/);
  assert.match(support, /\.split\(whereSeparator: \{ \$0.isWhitespace \}\)/);
  assert.match(support, /\$0.entry.date > \$1.entry.date/);
  assert.match(support, /\$0.paperUpdatedAt > \$1.paperUpdatedAt/);
  assert.match(support, /\$0.position < \$1.position/);
  assert.match(support, /\$0.entry.entryID < \$1.entry.entryID/);
  assert.match(support, /URLQueryItem\(name: "limit", value: "51"\)/);
});

test("Partial retry and committed-paper reconciliation remain root-owned", () => {
  const view = fs.readFileSync(`${root}DaySpaceView.swift`, "utf8");
  const todoRetry = view.slice(view.indexOf("private func retryTodo"), view.indexOf("private func retryDiary"));
  const diaryRetry = view.slice(view.indexOf("private func retryDiary"), view.indexOf("private func readTodo"));
  assert.match(todoRetry, /todoState = \.loading\(todoState.value\)/);
  assert.doesNotMatch(todoRetry, /diaryState\s*=/);
  assert.match(diaryRetry, /diaryState = \.loading\(diaryState.value\)/);
  assert.doesNotMatch(diaryRetry, /todoState\s*=/);
  assert.match(view, /committed.entries.isEmpty \? nil : committed/);
  assert.match(view, /diaries\[index\] = committed/);
  assert.match(view, /todoState = \.error\(current\)/);
  assert.match(view, /diaryState = \.error\(diaries\)/);
  assert.match(view, /\.fullScreenCover\(item: \$createSelection\)/);
  assert.match(view, /\.fullScreenCover\(item: \$selection\)/);
});
