import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import test from "node:test";

test("actual native API sends undated with the existing sort and pagination; search retains keywords", {skip:process.platform!=="darwin"}, () => {
  const directory = mkdtempSync(join(tmpdir(),"mind-undated-swift-"));
  try {
    writeFileSync(join(directory,"main.swift"), `
import Foundation
enum LeileiAPIError: Error { case invalidResponse }
final class LeileiAPIClient {
  var paths: [String] = []
  func request<T: Decodable>(path: String, method: String = "GET", body: Data? = nil, authenticated: Bool, idempotencyKey: String? = nil) async throws -> T {
    paths.append(path)
    return try JSONDecoder().decode(T.self,from:Data(#"{"success":true,"data":{"items":[],"nextCursor":null}}"#.utf8))
  }
}
func params(_ path: String) -> [String:String] {
  Dictionary(uniqueKeysWithValues: URLComponents(string:path)!.queryItems!.map {($0.name,$0.value!)})
}
Task {
  let api = LeileiAPIClient()
  _ = try await api.mindPage(kind:.memory,sort:.occurredDesc,undated:true,cursor:"page+2")
  precondition(params(api.paths.last!) == ["limit":"100","kind":"memory","sort":"occurred_desc","undated":"true","cursor":"page+2"])
  _ = try await api.mindPage(kind:.memory)
  precondition(params(api.paths.last!)["undated"] == nil)
  _ = try await api.memorySearch(query:"sample",undated:true,cursor:"page+3")
  precondition(params(api.paths.last!) == ["limit":"100","query":"sample","undated":"true","cursor":"page+3"])
  print("PASS")
  exit(0)
}
RunLoop.main.run()
`);
    const root = "ios/LeileiOS/LeileiOS/Infrastructure/API/Mind/";
    execFileSync("swiftc",["-module-cache-path",join(directory,"cache"),root+"MindModels.swift",root+"MindAPI.swift",join(directory,"main.swift"),"-o",join(directory,"check")],{timeout:120000});
    assert.match(execFileSync(join(directory,"check"),{encoding:"utf8",timeout:10000}),/PASS/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test("native undated toggle uses the existing menu with a native separator and fences replaced pages", () => {
  const source = readFileSync("ios/LeileiOS/LeileiOS/Pages/Mind/MindKindList.swift","utf8");
  assert.match(source,/\.pickerStyle\(\.inline\)\s*Divider\(\)\s*Button\("Filter Date"\)/);
  assert.match(source,/Divider\(\)\s*Toggle\("Undated Only", isOn: \$undatedOnly\)/);
  assert.match(source,/requestedUndated == undatedOnly/);
  assert.match(source,/if ticket == listGeneration \{ loadingMore = false \}/);
  assert.match(source,/if ticket == searchGeneration \{ searchLoadingMore = false \}/);
});
