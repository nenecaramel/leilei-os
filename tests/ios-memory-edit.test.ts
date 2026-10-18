import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { swiftDeclarations } from "./helpers/ios-swift-declarations.js";

test(
  "actual Swift Memory edit encodes version, explicit null and timestamp",
  { skip: process.platform !== "darwin" },
  () => {
    const temporary = mkdtempSync(join(tmpdir(), "mind-kind-check-"));
    try {
      const executable = join(temporary, "check");
      const build = spawnSync(
        "swiftc",
        [
          "-module-cache-path",
          join(temporary, "cache"),
          "ios/LeileiOS/LeileiOS/Infrastructure/API/Mind/MindModels.swift",
          "tests/fixtures/mind/MemoryUpdate.swift",
          "-o",
          executable,
        ],
        { encoding: "utf8", timeout: 120000 },
      );
      assert.equal(build.status, 0, build.stderr);
      const run = spawnSync(executable, [], {
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /PASS/);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);

// Compile the production mutation methods, rather than a replica of their logic.
for (const scenario of ["edit", "delete"]) {
  test(`actual Swift Mind ${scenario} reconciles filtered rows and global count without resetting pages`, { skip: process.platform !== "darwin" }, () => {
    const declaration = swiftDeclarations("ios/LeileiOS/LeileiOS/Pages/Mind/MindKindList.swift");
    const searchPage = swiftDeclarations("ios/LeileiOS/LeileiOS/Infrastructure/API/Mind/MindAPI.swift")("struct_decl", "MemorySearchPage");
    const directory = mkdtempSync(join(tmpdir(), "mind-mutations-swift-"));
    try {
      writeFileSync(join(directory, "main.swift"), `
import Foundation
${readFileSync("ios/LeileiOS/LeileiOS/Infrastructure/API/Mind/MindModels.swift", "utf8")}
${readFileSync("ios/LeileiOS/LeileiOS/Pages/Mind/MindPresentation.swift", "utf8")}
${searchPage}
func memory(_ id: String, _ text: String, _ occurred: String?) -> MindProductItem {
  var json: [String: Any] = ["id": id, "kind": "memory", "text": text, "source": "manual",
    "lifecycle": ["state": "active", "strength": 0.75], "provenance": ["sourceCount": 0, "sourceKinds": []],
    "createdAt": "2026-10-13T00:00:00Z", "updatedAt": "2026-10-18T00:00:00Z"]
  json["occurredAt"] = occurred
  return try! JSONDecoder().decode(MindProductItem.self, from: JSONSerialization.data(withJSONObject: json))
}
@MainActor final class API {
  func mindPage(kind: MindProductKind, sort: MindListSort, undated: Bool) async throws -> MindProductPage {
    MindProductPage(items: [], nextCursor: nil, totalCount: 240)
  }
}
@MainActor final class Model { let api = API() }
@MainActor final class Harness {
  let appModel = Model()
  var deletedMindItemIDs: Set<String> = []
  var sort = MindListSort.updatedDesc, listGeneration = 0
  var loading = false, failed = false, loadingMore = false
  var items: [MindProductItem] = []
  var searchRows: [MemorySearchPage.Entry] = []
  var totalCount: Int? = 237
  var undatedOnly = false, query = ""
  var selectedDate: String?
  var nextCursor: String? = "normal-page-3", searchCursor: String? = "search-page-2"
  var listScrollPosition: String? = "untouched", searchScrollPosition: String? = "untouched"
  ${declaration("func_decl", "reload(preservingContent:)")}
  ${declaration("func_decl", "removeMindItem(id:)")}
  ${declaration("func_decl", "updateMindItem(_:)" )}
  func seed(_ occurred: String? = "2026-10-17T17:30:00Z") {
    items = [memory("untouched", "other", nil), memory("edited", "coffee", occurred)]
    searchRows = [.init(id: "untouched", snippet: "other", date: nil), .init(id: "edited", snippet: "coffee", date: "2026-10-18")]
  }
  func retained() {
    precondition(nextCursor == "normal-page-3" && searchCursor == "search-page-2", "mutation discarded cursor pages")
    precondition(listScrollPosition == "untouched" && searchScrollPosition == "untouched", "mutation moved scroll anchors")
  }
}
Task { @MainActor in
  let h = Harness()
  if "${scenario}" == "edit" {
    h.seed()
    let moved = memory("edited", "Coffee updated", "2026-10-18T17:30:00Z")
    h.updateMindItem(moved)
    precondition(h.searchRows.last?.date == "2026-10-19", "edit retained the old Shanghai event date")
    precondition(h.items.last == moved, "feed must use the server updated object, including lifecycle")
    precondition(h.searchRows.last?.snippet == "Coffee updated")
    h.retained()
    h.seed(); h.selectedDate = "2026-10-18"
    h.updateMindItem(moved)
    precondition(h.searchRows.map(\\.id) == ["untouched"], "edited memory remained in its old date filter")
    precondition(h.items.last == moved && h.totalCount == 237)
    h.seed(); h.selectedDate = nil; h.query = "coffee"
    h.updateMindItem(memory("edited", "tea", nil))
    precondition(h.searchRows.map(\\.id) == ["untouched"], "edited memory remained in a nonmatching search")
    h.seed(); h.query = " CAFÉ   TIME "; h.undatedOnly = false
    h.updateMindItem(memory("edited", "A café\\n time today", nil))
    precondition(h.searchRows.last?.id == "edited" && h.searchRows.last?.date == nil, "normalized matching search or cleared date was lost")
    h.seed(nil); h.query = ""; h.undatedOnly = true
    h.updateMindItem(moved)
    precondition(h.items.map(\\.id) == ["untouched"] && h.searchRows.map(\\.id) == ["untouched"], "dated edit remained in undated feeds")
    precondition(h.totalCount == 237, "an edit must not decrement global count")
    h.retained()
  } else {
    let editedOut = Harness()
    editedOut.seed(nil); editedOut.undatedOnly = true; editedOut.query = "coffee"
    editedOut.updateMindItem(memory("edited", "tea", "2026-10-18T17:30:00Z"))
    precondition(!editedOut.items.contains { $0.id == "edited" } && !editedOut.searchRows.contains { $0.id == "edited" })
    editedOut.removeMindItem(id: "edited")
    precondition(editedOut.totalCount == 236, "delete after edit left both filters must still decrement global count")
    editedOut.removeMindItem(id: "edited")
    precondition(editedOut.totalCount == 236, "duplicate callback after edit-out delete decremented twice")
    await editedOut.reload(preservingContent: true)
    precondition(editedOut.totalCount == 240, "refresh must replace optimistic count with server total")
    editedOut.removeMindItem(id: "edited")
    precondition(editedOut.totalCount == 240, "delayed duplicate after authoritative refresh decremented twice")
    editedOut.removeMindItem(id: "another-successful-delete")
    precondition(editedOut.totalCount == 239, "fresh successful deletion outside visible feeds was lost")
    let newOwner = Harness()
    newOwner.removeMindItem(id: "edited")
    precondition(newOwner.totalCount == 236, "a new feed owner must start with fresh callback accounting")
    h.seed()
    h.searchRows.append(.init(id: "outside-first-100", snippet: "remote result", date: nil))
    h.removeMindItem(id: "outside-first-100")
    precondition(h.totalCount == 236, "deleting search-only memory left global count unchanged")
    h.removeMindItem(id: "outside-first-100")
    precondition(h.totalCount == 236, "duplicate delete decremented twice")
    h.removeMindItem(id: "edited")
    precondition(h.totalCount == 235, "same ID in both feeds must decrement once")
    precondition(h.items.map(\\.id) == ["untouched"] && h.searchRows.map(\\.id) == ["untouched"])
    h.totalCount = nil; h.removeMindItem(id: "untouched"); precondition(h.totalCount == nil)
    h.seed(); h.totalCount = 0; h.removeMindItem(id: "edited"); precondition(h.totalCount == 0)
    h.retained()
  }
  print("PASS")
  exit(0)
}
RunLoop.main.run()
`);
      const executable = join(directory, "check");
      const build = spawnSync("swiftc", ["-module-cache-path", join(directory, "cache"), join(directory, "main.swift"), "-o", executable], { encoding: "utf8", timeout: 120000 });
      assert.equal(build.status, 0, build.stderr);
      const run = spawnSync(executable, [], { encoding: "utf8", timeout: 10000 });
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /PASS/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
