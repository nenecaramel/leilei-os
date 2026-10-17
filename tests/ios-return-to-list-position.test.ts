import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = "ios/LeileiOS/LeileiOS/Pages/";
const read = (path: string) => readFileSync(root + path, "utf8");

test("Diary list holds a stable scroll anchor and refreshes behind detail without tearing down its rows", () => {
  const page = read("DiaryView.swift");
  const rows = read("Diary/DiaryListPresentation.swift");
  assert.match(page, /@State private var listScrollPosition: String\?/);
  assert.match(page, /DiaryList\(diaries: visibleDiaries, scrollPosition: \$listScrollPosition\)/);
  assert.match(rows, /@Binding var scrollPosition: String\?/);
  assert.match(rows, /\.scrollPosition\(id: \$scrollPosition\)/);
  assert.match(rows, /\.id\(diary\.id\)/);
  assert.match(page, /await loadDiary\(preservingContent: true\)/);
  assert.match(page, /\.task \{[\s\S]*?if case \.loaded = state \{ return \}/);
});

test("Archive preserves later loaded batches and their scroll anchor after detail changes", () => {
  const archive = read("Diary/Archive/DiaryArchivePresentation.swift");
  assert.match(archive, /@State private var listScrollPosition: String\?/);
  assert.match(archive, /scrollPosition: \$listScrollPosition/);
  assert.match(archive, /@Binding var scrollPosition: String\?/);
  assert.match(archive, /\.scrollPosition\(id: \$scrollPosition\)/);
  assert.match(archive, /\.id\(diary\.id\)/);
  assert.match(archive, /private func removeArchivedEntry\(_ id: String\)/);
  assert.match(archive, /completeArchive\?\.removeAll/);
  assert.match(archive, /state = \.loaded\(remaining\)/);
  assert.match(archive, /onChanged: \{ onRemoved\(diary\.id\) \}/);
  assert.match(archive, /\.task \{\s*if case \.loaded = state \{ return \}/);
});

test("Mind keeps feed/search pagination and independent scroll positions across detail navigation", () => {
  const list = read("Mind/MindKindList.swift");
  const detail = read("Mind/MindItemDetail.swift");
  const readDetail = read("Mind/MindMemoryReadView.swift");
  assert.match(list, /@State private var listScrollPosition: String\?/);
  assert.match(list, /@State private var searchScrollPosition: String\?/);
  assert.match(list, /\.scrollPosition\(id: \$listScrollPosition\)/);
  assert.match(list, /\.scrollPosition\(id: \$searchScrollPosition\)/);
  assert.match(list, /\.id\(item\.id\)/);
  assert.match(list, /\.id\(row\.id\)/);
  assert.match(list, /private func removeMindItem\(id: String\)/);
  assert.match(list, /private func updateMindItem\(_ updated: MindProductItem\)/);
  assert.match(list, /lastListTaskKey/);
  assert.match(list, /lastSearchTaskKey/);
  assert.match(list, /searchRows\.append/);
  assert.match(list, /items\.append/);
  assert.match(detail, /onUpdated\?\(updated\)/);
  assert.match(detail, /onDeleted\(\)\s*dismiss\(\)/);
  assert.match(readDetail, /onUpdated: onUpdated/);
});
