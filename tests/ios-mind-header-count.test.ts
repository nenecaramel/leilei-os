import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { swiftDeclarations } from "./helpers/ios-swift-declarations.js";

const mindList = readFileSync("ios/LeileiOS/LeileiOS/Pages/Mind/MindKindList.swift", "utf8");
const diaryTitle = readFileSync("ios/LeileiOS/LeileiOS/Pages/Diary/DiaryListPresentation.swift", "utf8");
const mindModels = readFileSync("ios/LeileiOS/LeileiOS/Infrastructure/API/Mind/MindModels.swift", "utf8");

test("Mind reuses the centered Diary title and the server count, never page length", () => {
  assert.match(diaryTitle, /struct DiaryNavigationTitle: View/u);
  assert.match(diaryTitle, /\.hidden\(\)/u);
  assert.match(mindList, /ToolbarItem\(placement: \.principal\)\s*\{\s*DiaryNavigationTitle\(title: "Mind", count: totalCount\)/u);
  assert.match(mindList, /@State private var totalCount: Int\?/u);
  assert.match(mindList, /totalCount = page\.totalCount/u);
  assert.doesNotMatch(mindList, /totalCount\s*=\s*(?:items|searchRows)\.count/u);
  assert.match(mindModels, /struct MindProductPage[\s\S]*?let totalCount: Int\?/u);
});

test("Swift Mind page decoding handles both new and older list responses", { skip: process.platform !== "darwin" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "mind-title-count-swift-"));
  try {
    writeFileSync(join(directory, "main.swift"), `
import Foundation
let decoder = JSONDecoder()
let newPage = try decoder.decode(MindProductPage.self, from: Data(#"{"items":[],"nextCursor":null,"totalCount":237}"#.utf8))
precondition(newPage.totalCount == 237)
let oldPage = try decoder.decode(MindProductPage.self, from: Data(#"{"items":[],"nextCursor":null}"#.utf8))
precondition(oldPage.totalCount == nil)
let emptyPage = try decoder.decode(MindProductPage.self, from: Data(#"{"items":[],"nextCursor":null,"totalCount":0}"#.utf8))
precondition(emptyPage.totalCount == 0)
print("PASS")
`);
    execFileSync("swiftc", [
      "-module-cache-path", join(directory, "cache"),
      "ios/LeileiOS/LeileiOS/Infrastructure/API/Mind/MindModels.swift",
      join(directory, "main.swift"), "-o", join(directory, "check"),
    ], { timeout: 120_000 });
    assert.match(execFileSync(join(directory, "check"), { encoding: "utf8", timeout: 10_000 }), /PASS/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("actual search pull-to-refresh reloads the global count and rejects an older list response", { skip: process.platform !== "darwin" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "mind-count-refresh-swift-"));
  const declaration = swiftDeclarations("ios/LeileiOS/LeileiOS/Pages/Mind/MindKindList.swift");
  const searchPage = swiftDeclarations("ios/LeileiOS/LeileiOS/Infrastructure/API/Mind/MindAPI.swift")("struct_decl", "MemorySearchPage");
  const swift = `import Foundation
${mindModels}
${searchPage}
@MainActor final class API {
 var serverCount: Int? = 256
 var reads = 0
 var searches = 0
 var pauseNext = false
 var paused: CheckedContinuation<Void, Never>?
 var started: CheckedContinuation<Void, Never>?
 var pauseSearch = false
 var pausedSearch: CheckedContinuation<Void, Never>?
 var startedSearch: CheckedContinuation<Void, Never>?
 func waitForSearchPause() async {
   if pausedSearch != nil { return }
   await withCheckedContinuation { startedSearch = $0 }
 }
 func waitForPause() async {
   if paused != nil { return }
   await withCheckedContinuation { started = $0 }
 }
 func mindPage(kind: MindProductKind, sort: MindListSort, undated: Bool) async throws -> MindProductPage {
   reads += 1
   let count = serverCount
   if pauseNext {
     pauseNext = false
     await withCheckedContinuation { paused = $0; started?.resume(); started = nil }
   }
   return MindProductPage(items: [], nextCursor: nil, totalCount: count)
 }
 func memorySearch(query: String, date: String?, undated: Bool) async throws -> MemorySearchPage {
   searches += 1
   if pauseSearch {
     pauseSearch = false
     await withCheckedContinuation { pausedSearch = $0; startedSearch?.resume(); startedSearch = nil }
   }
   return MemorySearchPage(items: [.init(id: "10000000-0000-4000-8000-000000000001", snippet: "Synthetic fresh result", date: nil)], nextCursor: nil)
 }
}
@MainActor final class Model { let api = API() }
@MainActor final class Harness {
 let appModel = Model()
 var items: [MindProductItem] = []
 var nextCursor: String?
 var totalCount: Int? = 237
 var loading = false, failed = false, loadingMore = false
 var listGeneration = 0
 var sort: MindListSort = .updatedDesc
 var undatedOnly = false
 var selectedDate: String?
 var query = "filtered fixture"
 var searchRows: [MemorySearchPage.Entry] = []
 var searchCursor: String?
 var searchLoading = false, searchLoadingMore = false, searchFailed = false, searchRefreshFailed = false
 var searchGeneration = 0
 var isSearching: Bool { selectedDate != nil || !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
 ${declaration("func_decl", "reload(preservingContent:)")}
 ${declaration("func_decl", "searchIfNeeded(skipDelay:preservingContent:)")}
 func beginOlderListRead() async { await reload(preservingContent: true) }
 func beginSearchRead() async { await searchIfNeeded(skipDelay: true, preservingContent: true) }
 func pullToRefresh() async { await searchIfNeeded(skipDelay: true, preservingContent: true) }
}
@main struct Check {
 @MainActor static func main() async {
   let h = Harness()
   await h.pullToRefresh()
   precondition(h.totalCount == 256, "search refresh left stale global count")
   precondition(h.appModel.api.reads == 1 && h.appModel.api.searches == 1)
   h.appModel.api.pauseNext = true
   let old = Task { await h.beginOlderListRead() }
   await h.appModel.api.waitForPause()
   h.appModel.api.serverCount = 257
   await h.pullToRefresh()
   precondition(h.totalCount == 257)
   h.appModel.api.paused?.resume(); h.appModel.api.paused = nil
   await old.value
   precondition(h.totalCount == 257, "older reload overwrote refreshed count")
   h.appModel.api.serverCount = 0
   await h.pullToRefresh()
   precondition(h.totalCount == 0)
   h.appModel.api.serverCount = nil
   await h.pullToRefresh()
   precondition(h.totalCount == nil, "legacy server should omit count")
   h.appModel.api.serverCount = 600
   h.appModel.api.pauseNext = true
   let fresh = Task { await h.beginOlderListRead() }
   await h.appModel.api.waitForPause()
   let alreadyCancelled = Task { await h.beginOlderListRead() }
   alreadyCancelled.cancel()
   await alreadyCancelled.value
   h.appModel.api.paused?.resume(); h.appModel.api.paused = nil
   await fresh.value
   precondition(h.totalCount == 600, "cancelled task invalidated a newer live count")
   h.searchRows = []
   h.appModel.api.pauseSearch = true
   let freshSearch = Task { await h.beginSearchRead() }
   await h.appModel.api.waitForSearchPause()
   let cancelledSearch = Task { await h.beginSearchRead() }
   cancelledSearch.cancel()
   await cancelledSearch.value
   h.appModel.api.pausedSearch?.resume(); h.appModel.api.pausedSearch = nil
   await freshSearch.value
   precondition(h.searchRows.map { $0.snippet } == ["Synthetic fresh result"], "cancelled task invalidated newer search results")
   print("Refresh count PASS")
 }
}
`;
  try {
    writeFileSync(join(directory, "refresh.swift"), swift);
    execFileSync("swiftc", ["-parse-as-library", "-module-cache-path", join(directory, "cache"), join(directory, "refresh.swift"), "-o", join(directory, "check")], { timeout: 120_000 });
    assert.match(execFileSync(join(directory, "check"), { encoding: "utf8", timeout: 15_000 }), /Refresh count PASS/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
