import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGlobalSearchSnippet, GlobalSearchError, GlobalSearchService, type GlobalSearchResult } from "../src/domains/global-search/global-search-service.js";
import { GlobalSearchAuthenticationError } from "../src/mcp/tools/global-search/register.js";
import type { GlobalSearchQuery, GlobalSearchRepository, GlobalSearchRow } from "../src/domains/global-search/global-search-repository.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

const USER_ID="00000000-0000-4000-8000-000000000701";
const TASK_ID="00000000-0000-4000-8000-000000000003";
const rows:GlobalSearchRow[]=[
  {entityType:"memory",entityId:"00000000-0000-4000-8000-000000000001",stableName:"Café 计划",matchedField:"content",matchedValue:`${"前".repeat(100)}Café${"后".repeat(200)}`,matchReason:"exact_phrase",lifecycleStatus:"active",businessTime:new Date("2026-08-01T10:00:00Z"),timeBasis:"updated_at",updatedAt:new Date("2026-08-01T10:00:00Z"),rank:2,author:"C"},
  {entityType:"diary",entityId:"00000000-0000-4000-8000-000000000002",stableName:"精准词",matchedField:"title",matchedValue:"精准词",matchReason:"exact_stable_name",lifecycleStatus:"archived",businessTime:new Date("2026-07-30T16:00:00Z"),timeBasis:"diary_date",updatedAt:new Date("2026-08-01T09:00:00Z"),rank:1,author:null},
];
class Repository implements GlobalSearchRepository {
  calls:GlobalSearchQuery[]=[]; findCalls=0; result=rows;
  async findUser(){this.findCalls+=1;return {status:"active" as const,timezone:"Asia/Shanghai"};}
  async search(input:GlobalSearchQuery){this.calls.push(input);return this.result;}
}

test("GlobalSearchService validates before search, normalizes NFC, bounds snippets, and binds cursors",async()=>{
  const repo=new Repository(); const service=new GlobalSearchService(repo);
  await assert.rejects(service.search({userId:USER_ID,query:"　 "}), (e:unknown)=>e instanceof GlobalSearchError&&e.code==="INVALID_GLOBAL_SEARCH");
  assert.equal(repo.calls.length,0);
  assert.equal(repo.findCalls,0);
  const first=await service.search({userId:USER_ID,query:"  Cafe\u0301  ",modules:["memory","diary"],scope:"all",date_from:"2026-07-01",date_to:"2026-08-01",limit:1});
  assert.equal(repo.calls[0]?.query,"Café");
  assert.equal([...(first.results[0]?.snippet ?? "")].length<=240,true);
  assert.equal(first.results[0]?.snippet.includes("Café"),true);
  assert.equal(first.metadata.has_more,true);
  assert.ok(first.metadata.next_cursor);
  const emojiSnippet=createGlobalSearchSnippet(`${"😀".repeat(200)}Café${"😀".repeat(200)}`,"Café");
  assert.equal([...emojiSnippet].length<=240,true);
  assert.equal(emojiSnippet.includes("Café"),true);
  assert.equal(emojiSnippet.length>240,true);
  repo.result=[];
  await service.search({userId:USER_ID,query:"Café",modules:["memory","diary"],scope:"all",date_from:"2026-07-01",date_to:"2026-08-01",limit:1,cursor:first.metadata.next_cursor!});
  assert.ok(repo.calls[1]?.after);
  await assert.rejects(service.search({userId:USER_ID,query:"different",modules:["memory","diary"],scope:"all",date_from:"2026-07-01",date_to:"2026-08-01",limit:1,cursor:first.metadata.next_cursor!}),/invalid/i);
  await assert.rejects(service.search({userId:USER_ID,query:"x",date_from:"2026-08-02",date_to:"2026-08-01"}),/invalid/i);
  repo.result=[]; await service.search({userId:USER_ID,query:"x".repeat(200),limit:25});
  await assert.rejects(service.search({userId:USER_ID,query:"x".repeat(201)}),/invalid/i);
  await assert.rejects(service.search({userId:USER_ID,query:"x",cursor:"not-a-valid-cursor"}),/invalid/i);
  await assert.rejects(service.search({userId:USER_ID,query:"x",modules:["memory","unknown"]}),/invalid/i);
});

test("GlobalSearchService returns a stored C author without adding an author filter", async () => {
  const repo = new Repository();
  repo.result = [rows[0]!];
  const result = await new GlobalSearchService(repo).search({ userId: USER_ID, query: "Café", modules: ["memory"] });
  assert.equal(result.results[0]?.author, "C");
  assert.equal("author" in (repo.calls[0] ?? {}), false);
});

test("global_search is strict, read-only, server-owned, and returns detail instructions",async(t)=>{
  const calls:unknown[]=[];
  const result:GlobalSearchResult={results:[{entity_type:"task",entity_id:TASK_ID,stable_name:"计划",snippet:"😀".repeat(240),matched_field:"title",match_reason:"exact_stable_name",lifecycle_status:"archived",business_time:"2026-08-01T00:00:00.000Z",time_basis:"created_at",updated_at:"2026-08-01T00:00:00.000Z",author:"C",detail_tool:"get_task",detail_arguments:{id:TASK_ID,scope:"archived"}}],metadata:{count:1,has_more:false,next_cursor:null,searched_modules:["task"],searched_scope:"all"}};
  const server=createMcpServer({globalSearch:{globalSearchService:{async search(input){calls.push(input);return result;}},getAuthenticatedUserId:()=>USER_ID}});
  const client=new Client({name:"global-search-test",version:"1"},{capabilities:{}}); const [a,b]=InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a); t.after(async()=>{await client.close();await server.close();});
  const tools=(await client.listTools()).tools; assert.equal(tools.length,50); const tool=tools.find((x)=>x.name==="global_search")!;
  assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});
  const properties=tool.inputSchema.properties as Record<string,unknown>; assert.equal("user_id" in properties,false);assert.equal("userId" in properties,false);
  const rejected=await client.callTool({name:"global_search",arguments:{query:"计划",user_id:USER_ID}}); assert.equal(rejected.isError,true); assert.equal(calls.length,0);
  const empty=await client.callTool({
    name:"global_search",
    arguments:{query:""},
  });
  assert.equal(empty.isError,true);
  assert.equal(calls.length,0);

  const oversized=await client.callTool({
    name:"global_search",
    arguments:{query:"x".repeat(201)},
  });
  assert.equal(oversized.isError,true);
  assert.equal(calls.length,0);
  const unicodeBoundaryQuery="😀".repeat(200);
  const unicodeBoundary=await client.callTool({
    name:"global_search",
    arguments:{query:unicodeBoundaryQuery,modules:["task"],scope:"all"},
  });
  assert.equal(unicodeBoundary.isError,undefined);
  assert.equal(calls.length,1);
  assert.equal((calls[0] as {query:string}).query,unicodeBoundaryQuery);
  const ok=await client.callTool({name:"global_search",arguments:{query:"计划",modules:["task"],scope:"all"}}); assert.equal(ok.isError,undefined); assert.equal(calls.length,2); assert.equal((calls[1] as {userId:string}).userId,USER_ID); assert.deepEqual((ok.structuredContent as {data:GlobalSearchResult}).data.results[0]?.detail_arguments,{id:TASK_ID,scope:"archived"});
});


test("global_search reports missing authentication without calling the service",async(t)=>{
  let serviceCalled=false;
  const server=createMcpServer({
    globalSearch:{
      globalSearchService:{
        async search(){
          serviceCalled=true;
          throw new Error("service must not run");
        },
      },
      getAuthenticatedUserId:()=>{
        throw new GlobalSearchAuthenticationError();
      },
    },
  });
  const client=new Client({name:"global-search-auth-test",version:"1"},{capabilities:{}});
  const [a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  t.after(async()=>{
    await client.close();
    await server.close();
  });
  const result=await client.callTool({name:"global_search",arguments:{query:"计划"}});
  assert.equal(result.isError,true);
  assert.equal(serviceCalled,false);
  assert.match(JSON.stringify(result),/Authentication is required to use global search/);
});

test("global_search output schema keeps module detail IDs strict while accepting Universe IDs", async (t) => {
  const base = {
    stable_name: "结果",
    snippet: "命中",
    matched_field: "content" as const,
    match_reason: "field_match" as const,
    lifecycle_status: "active" as const,
    business_time: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
  const cases = [
    ["memory", "get_memory"],
    ["diary", "get_diary"],
    ["task", "get_task"],
  ] as const;

  for (const [entityType, detailTool] of cases) {
    const server = createMcpServer({
      globalSearch: {
        globalSearchService: {
          async search() {
            return {
              results: [{ ...base, entity_type: entityType, entity_id: "00000000-0000-4000-8000-000000000001", detail_tool: detailTool, detail_arguments: { id: "not-a-uuid", scope: "active" as const } }],
              metadata: { count: 1, has_more: false, next_cursor: null, searched_modules: [entityType], searched_scope: "active" as const },
            };
          },
        },
        getAuthenticatedUserId: () => USER_ID,
      },
    });
    const client = new Client({ name: `global-search-invalid-${entityType}`, version: "1" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    t.after(async () => { await client.close(); await server.close(); });
    const response = await client.callTool({ name: "global_search", arguments: { query: "结果", modules: [entityType] } });
    assert.equal(response.isError, true);
  }
});


test("GlobalSearchService rejects structurally invalid cursors before user lookup",async()=>{
  const repo=new Repository();
  const service=new GlobalSearchService(repo);
  const first=await service.search({
    userId:USER_ID,
    query:"Café",
    modules:["memory","diary"],
    scope:"all",
    date_from:"2026-07-01",
    date_to:"2026-08-01",
    limit:1,
  });
  const validCursor=first.metadata.next_cursor!;
  const findCallsBeforeInvalidCursor=repo.findCalls;

  const withExtraField=JSON.parse(Buffer.from(validCursor,"base64url").toString("utf8")) as Record<string,unknown>;
  withExtraField.extra=true;
  const extraFieldCursor=Buffer.from(JSON.stringify(withExtraField)).toString("base64url");

  await assert.rejects(service.search({
    userId:USER_ID,
    query:"Café",
    modules:["memory","diary"],
    scope:"all",
    date_from:"2026-07-01",
    date_to:"2026-08-01",
    limit:1,
    cursor:extraFieldCursor,
  }),/invalid/i);

  const invalidIdPayload=JSON.parse(Buffer.from(validCursor,"base64url").toString("utf8")) as {
    t:{entityId:string};
  };
  invalidIdPayload.t.entityId="task-1";
  const invalidIdCursor=Buffer.from(JSON.stringify(invalidIdPayload)).toString("base64url");

  await assert.rejects(service.search({
    userId:USER_ID,
    query:"Café",
    modules:["memory","diary"],
    scope:"all",
    date_from:"2026-07-01",
    date_to:"2026-08-01",
    limit:1,
    cursor:invalidIdCursor,
  }),/invalid/i);

  assert.equal(repo.findCalls,findCallsBeforeInvalidCursor);
});

test("GlobalSearchService rejects a repository row whose matched source does not contain the query",async()=>{
  const repo=new Repository();
  repo.result=[{
    ...rows[0],
    matchedValue:"repository contract violation",
  }];
  const service=new GlobalSearchService(repo);
  await assert.rejects(
    service.search({userId:USER_ID,query:"Café"}),
    /repository returned a non-matching snippet source/i,
  );
});
