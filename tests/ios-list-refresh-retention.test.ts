import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

function method(source: string, name: string) {
  const start = source.indexOf(`    private func ${name}(`);
  assert.ok(start >= 0);
  const opening = source.indexOf('{',start);
  let depth = 1, end = opening + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth,0);
  return source.slice(start,end).replace('private func','func');
}

test('actual Diary and Mind load methods retain rows through refresh success, failure, cancellation and stale replies', {skip:process.platform !== 'darwin'}, () => {
  const mind = readFileSync('ios/LeileiOS/LeileiOS/Pages/Mind/MindKindList.swift','utf8');
  const diary = readFileSync('ios/LeileiOS/LeileiOS/Pages/DiaryView.swift','utf8');
  const call = (source: string, name: string) => method(source,name).includes('preservingContent: Bool') ? `${name}(preservingContent: true)` : `${name}()`;
  const directory = mkdtempSync(join(tmpdir(),'list-refresh-swift-'));
  try {
    writeFileSync(join(directory,'main.swift'), `
import Foundation
enum LeileiAPIError: Error { case missingAccessToken, unauthorized }
enum Fault: Error { case unavailable }
enum MindListSort { case updatedDesc }
enum Kind { case memory }
struct Page { var items: [String]; var nextCursor: String?; var totalCount: Int? = nil }
@MainActor final class API {
  var pending: [CheckedContinuation<Page, Error>] = []
  func fetch() async throws -> Page { try await withCheckedThrowingContinuation { pending.append($0) } }
  func mindPage(kind: Kind, sort: MindListSort, undated: Bool) async throws -> Page { try await fetch() }
  func memorySearch(query: String?, date: String? = nil, undated: Bool) async throws -> Page { try await fetch() }
}
@MainActor final class Model {
  let api = API()
  func refreshConnectivity() async {}
}
@MainActor final class Mind {
  let appModel = Model()
  var items = ["old"], nextCursor: String? = "old-cursor"
  var loading = false, failed = false, loadingMore = false, listGeneration = 0
  var totalCount: Int? = 1
  var sort = MindListSort.updatedDesc, undatedOnly = false
  var searchRows = ["old"], searchCursor: String? = "old-cursor"
  var searchLoading = false, searchLoadingMore = false, searchFailed = false, searchGeneration = 0, searchRefreshFailed = false
  var selectedDate: String? = nil, query = "notes"
  var isSearching: Bool { selectedDate != nil || !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  ${method(mind,'reload')}
  ${method(mind,'searchIfNeeded')}
}
enum DiaryLoadState { case loading, loaded([String]), authRequired(String), unavailable(String) }
@MainActor final class Diary {
  let appModel = Model()
  var state = DiaryLoadState.loaded(["old"]), diaryCount: Int? = 1, loadGeneration = 0
  func loadAllDiaryPages() async throws -> (diaries: [String], count: Int) {
    let page = try await appModel.api.fetch(); return (page.items,page.items.count)
  }
  ${method(diary,'loadDiary')}
  func rows() -> [String] { if case .loaded(let rows) = state { return rows }; return [] }
}
@MainActor func wait(_ api: API, _ count: Int = 1) async { while api.pending.count < count { await Task.yield() } }
Task { @MainActor in
  for outcome in 0..<3 {
    let mind = Mind()
    let task = Task { await mind.${call(mind,'reload')} }
    await wait(mind.appModel.api)
    precondition(mind.items == ["old"] && mind.nextCursor == "old-cursor", "Mind refresh must retain rows and cursor while awaiting")
    if outcome == 1 { mind.appModel.api.pending[0].resume(throwing: Fault.unavailable) }
    else { if outcome == 2 { task.cancel() }; mind.appModel.api.pending[0].resume(returning: Page(items:["new"],nextCursor:"new-cursor")) }
    await task.value
    precondition(mind.items == (outcome == 0 ? ["new"] : ["old"]))
    precondition(!mind.loading)

    let search = Mind()
    let searchTask = Task { await search.${call(mind,'searchIfNeeded')} }
    await wait(search.appModel.api)
    precondition(search.searchRows == ["old"] && search.searchCursor == "old-cursor")
    if outcome == 1 { search.appModel.api.pending[0].resume(throwing: Fault.unavailable) }
    else { if outcome == 2 { searchTask.cancel() }; search.appModel.api.pending[0].resume(returning: Page(items:["new"],nextCursor:"new-cursor")) }
    if outcome == 0 {
      await wait(search.appModel.api, 2)
      precondition(search.items == ["old"] && search.totalCount == 1, "global refresh also retains existing feed/count while waiting")
      search.appModel.api.pending[1].resume(returning: Page(items:["refreshed-feed"],nextCursor:nil,totalCount:2))
    }
    await searchTask.value
    precondition(search.totalCount == (outcome == 0 ? 2 : 1))
    precondition(search.searchRows == (outcome == 0 ? ["new"] : ["old"]))
    precondition(!search.searchLoading)

    let diary = Diary()
    let diaryTask = Task { await diary.${call(diary,'loadDiary')} }
    await wait(diary.appModel.api)
    precondition(diary.rows() == ["old"], "Diary refresh must keep the loaded presentation")
    if outcome == 1 { diary.appModel.api.pending[0].resume(throwing: Fault.unavailable) }
    else { if outcome == 2 { diaryTask.cancel() }; diary.appModel.api.pending[0].resume(returning: Page(items:["new"],nextCursor:nil)) }
    await diaryTask.value
    precondition(diary.rows() == (outcome == 0 ? ["new"] : ["old"]))
  }
  let diary = Diary()
  let first = Task { await diary.${call(diary,'loadDiary')} }; await wait(diary.appModel.api)
  let second = Task { await diary.${call(diary,'loadDiary')} }; await wait(diary.appModel.api,2)
  diary.appModel.api.pending[1].resume(returning: Page(items:["latest"],nextCursor:nil)); await second.value
  diary.appModel.api.pending[0].resume(returning: Page(items:["stale"],nextCursor:nil)); await first.value
  precondition(diary.rows() == ["latest"] && diary.diaryCount == 1)
  let mind = Mind()
  let reset = Task { await mind.reload() }; await wait(mind.appModel.api)
  precondition(mind.items.isEmpty && mind.nextCursor == nil, "ordinary reload must still clear changed-filter results")
  mind.appModel.api.pending[0].resume(returning: Page(items:["reset"],nextCursor:nil)); await reset.value
  let search = Mind()
  let searchReset = Task { await search.searchIfNeeded(skipDelay:true) }; await wait(search.appModel.api)
  precondition(search.searchRows.isEmpty && search.searchCursor == nil)
  search.appModel.api.pending[0].resume(returning: Page(items:["reset"],nextCursor:nil)); await searchReset.value
  print("PASS")
  exit(0)
}
RunLoop.main.run()
`);
    execFileSync('swiftc',['-module-cache-path',join(directory,'cache'),join(directory,'main.swift'),'-o',join(directory,'check')],{timeout:120000});
    assert.match(execFileSync(join(directory,'check'),{encoding:'utf8',timeout:20000}),/PASS/);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('only pull-to-refresh opts into retention; replaced filters still use the reset loader', () => {
  const mind = readFileSync('ios/LeileiOS/LeileiOS/Pages/Mind/MindKindList.swift','utf8');
  const diary = readFileSync('ios/LeileiOS/LeileiOS/Pages/DiaryView.swift','utf8');
  assert.match(diary,/\.refreshable\s*\{\s*await loadDiary\(preservingContent: true\)/);
  assert.match(mind,/\.refreshable\s*\{\s*await reload\(preservingContent: true\)/);
  assert.match(mind,/\.refreshable\s*\{\s*await searchIfNeeded\(skipDelay: true, preservingContent: true\)/);
  assert.match(mind,/guard !loadingMore,\s*!loading,/);
});
