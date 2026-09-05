import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { createGlobalSearchApiHandler } from "../src/web-api/global-search-router.js";
import { GlobalSearchError, type GlobalSearchResult } from "../src/domains/global-search/global-search-service.js";

function recorder(){const state:{status:number;body?:unknown;headers:Record<string,string>}={status:200,headers:{}};const response={status(code:number){state.status=code;return this;},json(body:unknown){state.body=body;return this;},set(name:string,value:string){state.headers[name]=value;return this;}} as unknown as Response;return{state,response};}
const result:GlobalSearchResult={results:[],metadata:{count:0,has_more:false,next_cursor:null,searched_modules:["memory","diary","task"],searched_scope:"active"}};

test("Web global search returns C unchanged and has no author request parameter",async()=>{
  const cResult:GlobalSearchResult={results:[{entity_type:"memory",entity_id:"00000000-0000-4000-8000-000000000001",stable_name:"C record",snippet:"C record",matched_field:"content",match_reason:"field_match",lifecycle_status:"active",business_time:"2026-08-01T00:00:00.000Z",time_basis:"updated_at",updated_at:"2026-08-01T00:00:00.000Z",detail_tool:"get_memory",detail_arguments:{id:"00000000-0000-4000-8000-000000000001",scope:"active"},author:"C"}],metadata:{count:1,has_more:false,next_cursor:null,searched_modules:["memory"],searched_scope:"active"}};
  const calls:unknown[]=[];
  const handler=createGlobalSearchApiHandler({globalSearchService:{async search(input){calls.push(input);return cResult;}}});
  const {state,response}=recorder();
  await handler({webUserId:"user-a",query:{query:"record"}} as unknown as Request,response,()=>{});
  assert.equal((state.body as { data: GlobalSearchResult }).data.results[0]?.author,"C");
  assert.equal("author" in (calls[0] as Record<string, unknown>),false);
});

test("Web global search uses authenticated identity, shared contract, and no-store",async()=>{const calls:unknown[]=[];const handler=createGlobalSearchApiHandler({globalSearchService:{async search(input){calls.push(input);return result;}}});const {state,response}=recorder();await handler({webUserId:"user-a",query:{query:"计划",modules:"memory,task",scope:"all",limit:"5"}} as unknown as Request,response,()=>{});assert.equal(state.status,200);assert.equal(state.headers["Cache-Control"],"private, no-store");assert.equal(state.headers["Pragma"],"no-cache");assert.deepEqual(calls,[{userId:"user-a",query:"计划",modules:["memory","task"],scope:"all",mode:undefined,date_from:undefined,date_to:undefined,limit:5,cursor:undefined}]);});
test("Web global search rejects unauthenticated and maps safe errors",async()=>{let called=false;const handler=createGlobalSearchApiHandler({globalSearchService:{async search(){called=true;throw new GlobalSearchError("INVALID_GLOBAL_SEARCH","private query");}}});let rec=recorder();await handler({query:{query:"x"}} as unknown as Request,rec.response,()=>{});assert.equal(rec.state.status,401);assert.equal(called,false);rec=recorder();await handler({webUserId:"user",query:{query:"x"}} as unknown as Request,rec.response,()=>{});assert.equal(rec.state.status,400);assert.doesNotMatch(JSON.stringify(rec.state.body),/private query/);});


test("Web global search rejects ambiguous or unknown query parameters before service",async()=>{
  let calls=0;
  const handler=createGlobalSearchApiHandler({
    globalSearchService:{
      async search(){
        calls+=1;
        return result;
      },
    },
  });

  const invalidQueries:Record<string,unknown>[]=[
    {query:"计划",user_id:"client-owned"},
    {query:["计划","重复"]},
    {query:"计划",limit:"01"},
    {query:"计划",modules:["memory","task,diary"]},
    {query:"计划",scope:["active","all"]},
  ];

  for(const query of invalidQueries){
    const {state,response}=recorder();
    await handler(
      {webUserId:"user-a",query} as unknown as Request,
      response,
      ()=>{},
    );
    assert.equal(state.status,400);
    assert.equal(state.headers["Cache-Control"],"private, no-store");
    assert.equal(state.headers["Pragma"],"no-cache");
  }

  assert.equal(calls,0);
});
