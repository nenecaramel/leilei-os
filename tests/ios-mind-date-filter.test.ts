import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";

test("native date filter requests the full server day and preserves keyword and cursor", {skip:process.platform !== "darwin"}, () => {
  const directory = mkdtempSync(join(tmpdir(), "mind-date-swift-"));
  try {
    writeFileSync(join(directory, "main.swift"), `
import Foundation
enum LeileiAPIError: Error { case invalidResponse }
final class LeileiAPIClient {
  var paths: [String] = []
  func request<T: Decodable>(path: String, method: String = "GET", body: Data? = nil, authenticated: Bool, idempotencyKey: String? = nil) async throws -> T {
    precondition(authenticated)
    paths.append(path)
    return try JSONDecoder().decode(T.self, from: Data(#"{"success":true,"data":{"items":[],"nextCursor":null}}"#.utf8))
  }
}
func params(_ path: String) -> [String:String] {
  Dictionary(uniqueKeysWithValues: URLComponents(string:path)!.queryItems!.map {($0.name,$0.value!)})
}
Task {
  let boundary = ISO8601DateFormatter().date(from:"2026-10-11T16:30:00Z")!
  precondition(MindPresentation.filterDayKey(boundary) == "2026-10-12")
  precondition(MindPresentation.filterDayKey(MindPresentation.filterDayDate("2026-10-12")) == "2026-10-12")
  let api = LeileiAPIClient()
  _ = try await api.memorySearch(date:"2026-10-12")
  precondition(params(api.paths.last!) == ["limit":"100", "date_from":"2026-10-12", "date_to":"2026-10-12"])
  _ = try await api.memorySearch(query:"日期 & notes",date:"2026-10-12",cursor:"next+page")
  precondition(params(api.paths.last!) == ["limit":"100", "query":"日期 & notes", "date_from":"2026-10-12", "date_to":"2026-10-12", "cursor":"next+page"])
  _ = try await api.memorySearch(query:"notes")
  precondition(params(api.paths.last!) == ["limit":"100", "query":"notes"])
  print("PASS")
  exit(0)
}
RunLoop.main.run()
`);
    const root = "ios/LeileiOS/LeileiOS/Infrastructure/API/Mind/";
    execFileSync("swiftc", ["-module-cache-path",join(directory,"cache"),root+"MindModels.swift",root+"MindAPI.swift","ios/LeileiOS/LeileiOS/Pages/Mind/MindPresentation.swift",join(directory,"main.swift"),"-o",join(directory,"check")], {timeout:120000});
    assert.match(execFileSync(join(directory,"check"),{encoding:"utf8",timeout:10000}), /PASS/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test("date picker remains native and list/search lifecycle fences changes to the selected day", () => {
  const source = readFileSync("ios/LeileiOS/LeileiOS/Pages/Mind/MindKindList.swift","utf8");
  const picker = readFileSync("ios/LeileiOS/LeileiOS/Pages/Mind/MindDateFilter.swift","utf8");
  assert.match(source, /Button\("Filter Date"/);
  assert.match(source, /Button\("All Dates"/);
  assert.match(source, /\.sheet\(isPresented: \$dateFilterPresented\)/);
  assert.match(picker, /\.datePickerStyle\(\.graphical\)/);
  assert.match(picker, /Asia\/Shanghai/);
  const first = source.slice(source.indexOf("private func searchIfNeeded"), source.indexOf("private func loadMoreSearch"));
  const more = source.slice(source.indexOf("private func loadMoreSearch"),source.indexOf("private func reload()"));
  for (const part of [first,more]) {
    assert.match(part, /let requestedDate = selectedDate/);
    assert.match(part, /date: requestedDate/);
    assert.match(part, /requestedDate == selectedDate/);
  }
  assert.match(source, /selectedDate != nil/);
});
