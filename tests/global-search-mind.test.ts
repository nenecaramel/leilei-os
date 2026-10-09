import assert from "node:assert/strict";
import test from "node:test";
import { GlobalSearchService } from "../src/domains/global-search/global-search-service.js";
import { readGlobalSearchFilters } from "../web/src/pages/global-search-location.js";
import { createGlobalSearchResultDetailLocation, formatGlobalSearchBusinessDate, globalSearchResultTitle, globalSearchResultSnippet } from "../web/src/pages/global-search-result.js";

const id = "00000000-0000-4000-8000-000000000004";
test("Mind is included by default with an undated get_memory pointer", async () => {
  const service = new GlobalSearchService({
    async findUser() { return { status: "active", timezone: "Asia/Shanghai" }; },
    async search(input) {
      assert.ok(input.modules.includes("mind"));
      return [{entityType: "mind", entityId: id, stableName: "", matchedField: "text", matchedValue: "search memory", matchReason: "field_match", lifecycleStatus: "active", businessTime: new Date("2026-10-09T00:00:00Z"), timeBasis: "undated", updatedAt: new Date("2026-10-09T00:00:00Z"), rank: 4, author: null}];
    },
  });
  const result = await service.search({ userId: id, query: "memory" });
  assert.deepEqual(result.metadata.searched_modules, ["diary", "todo", "universe", "mind"]);
  assert.equal(result.results[0].business_time, null);
  assert.equal(result.results[0].stable_name, "");
  assert.equal(result.results[0].detail_tool, "get_memory");
  assert.deepEqual(result.results[0].detail_arguments, {id});
});
test("Web Mind filter and detail location preserve the search return URL, without an invented date", () => {
  assert.deepEqual(readGlobalSearchFilters("?modules=mind&q=memory").modules, ["mind"]);
  assert.ok(readGlobalSearchFilters("").modules.includes("mind"));
  const location = createGlobalSearchResultDetailLocation({entity_type:"mind",entity_id:id} as never, "/search?q=memory&modules=mind");
  const url = new URL(location, "https://example.invalid");
  assert.equal(url.pathname, "/mind");
  assert.equal(url.searchParams.get("memoryId"), id);
  assert.equal(url.searchParams.get("returnTo"), "/search?q=memory&modules=mind");
  assert.equal(formatGlobalSearchBusinessDate(null), "");
  assert.equal(formatGlobalSearchBusinessDate("2026-10-08T16:00:00.000Z", "memory_date"), "10/09");
  const memory = {entity_type: "mind", stable_name: "", snippet: "body preview"} as never;
  assert.equal(globalSearchResultTitle(memory), "body preview");
  assert.equal(globalSearchResultSnippet(memory), "");
});

test("MCP accepts Mind and nullable dates, but rejects forged Memory detail pointers", async t => {
  const {Client} = await import("@modelcontextprotocol/sdk/client/index.js");
  const {McpServer} = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const {InMemoryTransport} = await import("@modelcontextprotocol/sdk/inMemory.js");
  const {registerGlobalSearchTool} = await import("../src/mcp/tools/global-search/register.js");
  const data = {
    results: [{entity_type: "mind", entity_id: id, stable_name: "", snippet: "memory preview", matched_field: "text", match_reason: "field_match", lifecycle_status: "active", business_time: null, time_basis: "undated", updated_at: "2026-10-09T00:00:00.000Z", author: null, detail_tool: "get_memory", detail_arguments: {id}}],
    metadata: {count:1, has_more:false, next_cursor:null, searched_modules:["mind"], searched_scope:"active", searched_author:null},
  };
  const server = new McpServer({name:"mind-search",version:"1"});
  registerGlobalSearchTool(server, {getAuthenticatedUserId:()=>id, globalSearchService:{async search(input) {assert.deepEqual(input.modules,["mind"]); return data as never;}}});
  const client = new Client({name:"mind-search-test",version:"1"},{capabilities:{}});
  const [ct,st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  t.after(async()=>{await client.close();await server.close();});
  const tools = await client.listTools();
  assert.deepEqual((tools.tools[0].inputSchema.properties!.modules as {items:{enum:string[]}}).items.enum,["diary","todo","universe","mind"]);
  const ok = await client.callTool({name:"global_search",arguments:{query:"memory",modules:["mind"]}});
  assert.equal(ok.isError,undefined);
  assert.deepEqual(ok.structuredContent,{success:true,data});
  assert.match((ok.content as {text: string}[])[0].text, /^mind "memory preview" \[detail_tool=get_memory/);
  data.results[0].detail_arguments = {id:"00000000-0000-4000-8000-000000000005"};
  const forged = await client.callTool({name:"global_search",arguments:{query:"memory",modules:["mind"]}});
  assert.equal(forged.isError,true);
});
