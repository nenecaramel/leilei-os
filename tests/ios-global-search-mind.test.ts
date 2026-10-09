import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import test from "node:test";

test("native search decodes dated and undated Memory and includes all four modules", () => {
  const temporary = mkdtempSync(join(tmpdir(),"global-mind-swift-"));
  try {
    const source = readFileSync("ios/LeileiOS/LeileiOS/Pages/GlobalSearch/GlobalSearchService.swift","utf8").split("final class LeileiGlobalSearchService")[0];
    writeFileSync(join(temporary,"main.swift"), source + `
let json = #"{\"entity_type\":\"mind\",\"entity_id\":\"memory-id\",\"stable_name\":\"\",\"snippet\":\"body preview\",\"matched_field\":\"text\",\"match_reason\":\"field_match\",\"lifecycle_status\":\"active\",\"business_time\":null,\"time_basis\":\"undated\",\"updated_at\":\"2026-10-09T00:00:00.000Z\",\"author\":null,\"detail_tool\":\"get_memory\",\"detail_arguments\":{\"id\":\"memory-id\"}}"#
let item = try JSONDecoder().decode(GlobalSearchResultItem.self, from: Data(json.utf8))
precondition(item.entityType == .mind && item.businessTime == nil)
precondition(item.detailTool == "get_memory" && item.detailArguments?["id"] == "memory-id")
precondition(GlobalSearchModule.allCases.map(\\.rawValue) == ["diary", "todo", "universe", "mind"])
precondition(GlobalSearchModule.defaultModules.count == 4)
let dated = json.replacingOccurrences(of: "\\\"business_time\\\":null", with: "\\\"business_time\\\":\\\"2026-10-08T16:00:00.000Z\\\"")
let datedItem = try JSONDecoder().decode(GlobalSearchResultItem.self, from: Data(dated.utf8))
precondition(datedItem.businessTime == "2026-10-08T16:00:00.000Z")
print("native Mind search decoding PASS")
`);
    execFileSync("swiftc",["-module-cache-path",join(temporary,"cache"),join(temporary,"main.swift"),"-o",join(temporary,"test")],{timeout:120000});
    assert.match(execFileSync(join(temporary,"test"),{encoding:"utf8"}),/PASS/);
  } finally {rmSync(temporary,{recursive:true,force:true});}
});
test("native Mind results reuse the detail reader and keep search state in the navigation stack", () => {
  const root = readFileSync("ios/LeileiOS/LeileiOS/Pages/GlobalSearchView.swift","utf8");
  const row = readFileSync("ios/LeileiOS/LeileiOS/Pages/GlobalSearch/GlobalSearchResultRow.swift","utf8");
  assert.match(root,/navigationDestination\(item: \$memoryTarget\)/);
  assert.match(root,/MindMemoryReadView\(id: \$0.id/);
  assert.match(root,/loadMoreTask\?\.cancel\(\)\s*isLoadingMore = false/);
  assert.match(row,/case \.mind:[\s\S]*onOpenMemory\(result.entityID\)/);
  assert.match(row,/title: result.snippet, snippet: ""/);
  assert.doesNotMatch(root,/\/mind\/search|mindItem\(/);
});
