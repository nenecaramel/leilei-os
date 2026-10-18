import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { swiftDeclarations } from "./helpers/ios-swift-declarations.js";
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
  const listOwner = archive.slice(0, archive.indexOf("private struct DiaryArchiveList:"));
  const returnTask = listOwner.slice(listOwner.indexOf(".task {"), listOwner.indexOf(".refreshable {"));
  assert.match(returnTask.replace(/\/\/[^\n]*/g, ""), /\.task \{\s*if case \.loaded = state \{ return \}\s*await loadArchive\(\)\s*\}/);
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

// Execute the real state owner, rather than inferring retention from declarations.
test("actual Swift Archive return task and removal retain later batches, cache, count and anchor", { skip: process.platform !== "darwin" }, () => {
  const archivePath = root + "Diary/Archive/DiaryArchivePresentation.swift";
  const source = readFileSync(archivePath, "utf8");
  const listOwner = source.slice(0, source.indexOf("private struct DiaryArchiveList:"));
  const task = listOwner.slice(listOwner.indexOf(".task {"), listOwner.indexOf(".refreshable {"));
  const taskBody = task.slice(task.indexOf("{") + 1, task.lastIndexOf("}"));
  const remove = swiftDeclarations(archivePath)("func_decl", "removeArchivedEntry(_:)").replace("private func", "func");
  const modelPath = root + "Diary/DiaryModels.swift";
  const modelSource = readFileSync(modelPath, "utf8");
  const models = swiftDeclarations(modelPath);
  const archiveState = modelSource.match(/enum DiaryArchiveLoadState \{[^}]+\}/)?.[0];
  assert.ok(archiveState);
  const directory = mkdtempSync(join(tmpdir(), "ios-archive-return-"));
  try {
    writeFileSync(join(directory, "check.swift"), `import Foundation
${archiveState}
${["DiaryEntry", "DiaryComment", "DiaryCommentsMetadata"].map(name => models("struct_decl", name)).join("\n")}
@MainActor final class ArchiveOwner {
    var state: DiaryArchiveLoadState = .loading
    var completeArchive: [DiaryEntry]?
    var diaryCount: Int?
    var listScrollPosition: String? = "row-65"
    var loads = 0
    func loadArchive() async { loads += 1; state = .loading; completeArchive = nil; listScrollPosition = nil }
    func returnToList() async { ${taskBody} }
    ${remove}
}
@main struct Check {
    @MainActor static func main() async {
        func row(_ i: Int) -> DiaryEntry {
            DiaryEntry(id: "row-\\(i)", title: "title", content: nil, date: "2026-10-01", tags: [], mood: nil, createdAt: "created", updatedAt: "updated", author: nil, comments: nil, commentsMetadata: nil)
        }
        let owner = ArchiveOwner()
        let visible = (0..<100).map(row)
        owner.state = .loaded(visible)
        owner.completeArchive = (0..<150).map(row)
        owner.diaryCount = 150
        await owner.returnToList()
        precondition(owner.loads == 0 && owner.listScrollPosition == "row-65")
        owner.removeArchivedEntry("row-80")
        guard case .loaded(let remaining) = owner.state else { fatalError("lost loaded state") }
        precondition(remaining.map(\\.id) == visible.filter { $0.id != "row-80" }.map(\\.id))
        precondition(owner.completeArchive?.count == 149 && owner.completeArchive?.contains { $0.id == "row-80" } == false)
        precondition(owner.diaryCount == 149 && owner.listScrollPosition == "row-65")
        owner.removeArchivedEntry("missing")
        precondition(owner.diaryCount == 149 && owner.completeArchive?.count == 149)
        owner.state = .unavailable("Failed")
        owner.removeArchivedEntry("row-1")
        guard case .unavailable("Failed") = owner.state else { fatalError("nonloaded mutation") }
        precondition(owner.diaryCount == 149)
        await owner.returnToList()
        precondition(owner.loads == 1, "unavailable list still retries")
        owner.state = .loading
        await owner.returnToList()
        precondition(owner.loads == 2, "initial list still loads")
        print("Archive retention PASS")
    }
}`);
    execFileSync("xcrun", ["swiftc", "-parse-as-library", "-module-cache-path", join(directory, "cache"), join(directory, "check.swift"), "-o", join(directory, "check")], { timeout: 120000 });
    assert.match(execFileSync(join(directory, "check"), { encoding: "utf8", timeout: 20000 }), /Archive retention PASS/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
