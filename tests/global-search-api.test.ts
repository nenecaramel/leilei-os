import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { createGlobalSearchApiHandler } from "../src/web-api/global-search-router.js";
import { GlobalSearchError, type GlobalSearchResult } from "../src/domains/global-search/global-search-service.js";

function recorder(){const state:{status:number;body?:unknown;headers:Record<string,string>}={status:200,headers:{}};const response={status(code:number){state.status=code;return this;},json(body:unknown){state.body=body;return this;},set(name:string,value:string){state.headers[name]=value;return this;}} as unknown as Response;return{state,response};}
const result:GlobalSearchResult={results:[],metadata:{count:0,has_more:false,next_cursor:null,searched_modules:["memory","diary","task"],searched_scope:"active"}};

test("Web global search uses authenticated identity, shared contract, and no-store",async()=>{const calls:unknown[]=[];const handler=createGlobalSearchApiHandler({globalSearchService:{async search(input){calls.push(input);return result;}}});const {state,response}=recorder();await handler({webUserId:"user-a",query:{query:"计划",modules:"memory,task",scope:"all",limit:"5"}} as unknown as Request,response,()=>{});assert.equal(state.status,200);assert.equal(state.headers["Cache-Control"],"private, no-store");assert.deepEqual(calls,[{userId:"user-a",query:"计划",modules:["memory","task"],scope:"all",mode:undefined,date_from:undefined,date_to:undefined,limit:5,cursor:undefined}]);});
test("Web global search rejects unauthenticated and maps safe errors",async()=>{let called=false;const handler=createGlobalSearchApiHandler({globalSearchService:{async search(){called=true;throw new GlobalSearchError("INVALID_GLOBAL_SEARCH","private query");}}});let rec=recorder();await handler({query:{query:"x"}} as unknown as Request,rec.response,()=>{});assert.equal(rec.state.status,401);assert.equal(called,false);rec=recorder();await handler({webUserId:"user",query:{query:"x"}} as unknown as Request,rec.response,()=>{});assert.equal(rec.state.status,400);assert.doesNotMatch(JSON.stringify(rec.state.body),/private query/);});
