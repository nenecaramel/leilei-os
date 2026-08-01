import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GlobalSearchError, GlobalSearchService, type GlobalSearchResult } from "../src/domains/global-search/global-search-service.js";
import type { GlobalSearchQuery, GlobalSearchRepository, GlobalSearchRow } from "../src/domains/global-search/global-search-repository.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

const USER_ID="00000000-0000-4000-8000-000000000701";
const rows:GlobalSearchRow[]=[
  {entityType:"memory",entityId:"00000000-0000-4000-8000-000000000001",stableName:"Café 计划",matchedField:"content",matchedValue:`${"前".repeat(100)}精准词${"后".repeat(200)}`,matchReason:"exact_phrase",lifecycleStatus:"active",businessTime:new Date("2026-08-01T10:00:00Z"),timeBasis:"updated_at",updatedAt:new Date("2026-08-01T10:00:00Z"),rank:2},
  {entityType:"diary",entityId:"00000000-0000-4000-8000-000000000002",stableName:"精准词",matchedField:"title",matchedValue:"精准词",matchReason:"exact_stable_name",lifecycleStatus:"archived",businessTime:new Date("2026-07-30T16:00:00Z"),timeBasis:"diary_date",updatedAt:new Date("2026-08-01T09:00:00Z"),rank:1},
];
class Repository implements GlobalSearchRepository {
  calls:GlobalSearchQuery[]=[]; result=rows;
  async findUser(){return {status:"active" as const,timezone:"Asia/Shanghai"};}
  async search(input:GlobalSearchQuery){this.calls.push(input);return this.result;}
}

test("GlobalSearchService validates before search, normalizes NFC, bounds snippets, and binds cursors",async()=>{
  const repo=new Repository(); const service=new GlobalSearchService(repo);
  await assert.rejects(service.search({userId:USER_ID,query:"　 "}), (e:unknown)=>e instanceof GlobalSearchError&&e.code==="INVALID_GLOBAL_SEARCH");
  assert.equal(repo.calls.length,0);
  const first=await service.search({userId:USER_ID,query:"  Cafe\u0301  ",modules:["memory","diary"],scope:"all",date_from:"2026-07-01",date_to:"2026-08-01",limit:1});
  assert.equal(repo.calls[0]?.query,"Café"); assert.equal(first.results[0]?.snippet.length<=242,true); assert.equal(first.metadata.has_more,true); assert.ok(first.metadata.next_cursor);
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

test("global_search is strict, read-only, server-owned, and returns detail instructions",async(t)=>{
  const calls:unknown[]=[];
  const result:GlobalSearchResult={results:[{entity_type:"task",entity_id:"task-1",stable_name:"计划",snippet:"计划",matched_field:"title",match_reason:"exact_stable_name",lifecycle_status:"archived",business_time:"2026-08-01T00:00:00.000Z",time_basis:"created_at",updated_at:"2026-08-01T00:00:00.000Z",detail_tool:"get_task",detail_arguments:{id:"task-1",scope:"archived"}}],metadata:{count:1,has_more:false,next_cursor:null,searched_modules:["task"],searched_scope:"all"}};
  const server=createMcpServer({globalSearch:{globalSearchService:{async search(input){calls.push(input);return result;}},getAuthenticatedUserId:()=>USER_ID}});
  const client=new Client({name:"global-search-test",version:"1"},{capabilities:{}}); const [a,b]=InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a); t.after(async()=>{await client.close();await server.close();});
  const tools=(await client.listTools()).tools; assert.equal(tools.length,16); const tool=tools.find((x)=>x.name==="global_search")!;
  assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});
  const properties=tool.inputSchema.properties as Record<string,unknown>; assert.equal("user_id" in properties,false);assert.equal("userId" in properties,false);
  const rejected=await client.callTool({name:"global_search",arguments:{query:"计划",user_id:USER_ID}}); assert.equal(rejected.isError,true); assert.equal(calls.length,0);
  const ok=await client.callTool({name:"global_search",arguments:{query:"计划",modules:["task"],scope:"all"}}); assert.equal(ok.isError,undefined); assert.equal(calls.length,1); assert.equal((calls[0] as {userId:string}).userId,USER_ID); assert.deepEqual((ok.structuredContent as {data:GlobalSearchResult}).data.results[0]?.detail_arguments,{id:"task-1",scope:"archived"});
});
