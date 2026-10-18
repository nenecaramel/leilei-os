import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {eq} from "drizzle-orm";
import {createDatabase} from "../src/database/client.js";
import {runtimeSubjectStates,users} from "../src/database/schema.js";
import {createMindState} from "../src/domains/runtime/mind/mind-writer.js";
import {ClaudeCodeMindRecallService} from "../src/domains/runtime/mind/claude-code-mind-recall.js";
import {DEFAULT_MIND_LOOP_CONFIG} from "../src/domains/runtime/mind/default-backend-mind-runtime.js";
import {DrizzleSubjectStateRuntimePort} from "../src/domains/runtime/subject-state/subject-state-runtime-repository.js";
const url=process.env.DATABASE_URL;
const enabled=process.env.RUN_CLAUDE_CODE_MIND_DATABASE_TEST==="1" && !!url &&
  new URL(url).hostname==="127.0.0.1" && new URL(url).pathname.endsWith("_test");

test("SQL keyword candidates preserve Oct16 lexical results without a 256-row cutoff",{skip:!enabled},async t=>{
 const database=createDatabase(url!,{ssl:false});const db=database.db;
 const userId=randomUUID();
 t.after(async()=>{await db.delete(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId,userId));await db.delete(users).where(eq(users.id,userId));await database.close();});
 await db.insert(users).values({id:userId,email:`${userId}@example.test`,displayName:"synthetic lexical test"});
 const reader=new DrizzleSubjectStateRuntimePort(db);
 const receipts={create:async (i:{contextSha256:string})=>({recall_id:randomUUID(),context_sha256:i.contextSha256}),confirm:async()=>({outcome:"confirmed" as const})};
 const service=new ClaudeCodeMindRecallService(reader,DEFAULT_MIND_LOOP_CONFIG,"G",receipts);
 // Oct16 uses the canonical loop over a complete scoped read. Only keyword
 // selection is compared here; no real model, credentials or private Memory.
 const original=new ClaudeCodeMindRecallService({list:i=>reader.list(i)},DEFAULT_MIND_LOOP_CONFIG,"G",receipts);
 const add=async(text:string,subjectId="G",hidden=false)=>{
  const s=createMindState({id:randomUUID(),userId,subjectId,kind:"memory",text,source:{origin:"manual",occurredAt:null,note:null}});
  if(hidden)s.envelope.scope.visibility="hidden_system";
  await reader.append({userId,subjectId,states:[s]});return s.id;
 };
 const tea=await add("喜欢茉莉茶");await add("猫咪喜欢窗边");
 await add("ABİ");await add("PQI\u0307");await add("ＣＡＦＥ preference");await add("ﬃ ligature preference");await add("under_score exact identifier");
 const hidden=await add("hidden 茉莉茶","G",true);await add("foreign 茉莉茶","L");
 for(const query of ["茉莉茶","猫咪","abi","pqi","cafe","ffi","under_score","the","不存在", "x".repeat(300)+" 茉莉茶"]){
  await t.test(query.length>30?"keyword after character256":query,async()=>{
   const input={userId,sessionId:"synthetic",query,excludeIds:[hidden]};
   const expected=await original.recall(input);const actual=await service.recall(input);
   assert.deepEqual(actual.memory_ids,expected.memory_ids);assert.equal(actual.context,expected.context);
  });
 }
 const noLibraryRead=Object.assign(Object.create(reader),{list:async()=>{throw new Error("full-library fallback");}}) as DrizzleSubjectStateRuntimePort;
 assert.deepEqual((await new ClaudeCodeMindRecallService(noLibraryRead,DEFAULT_MIND_LOOP_CONFIG,"G",receipts).recall({userId,sessionId:"s",query:"茉莉茶",excludeIds:[]})).memory_ids,[tea]);
 const fillers=Array.from({length:300},(_,i)=>createMindState({id:randomUUID(),userId,subjectId:"G",kind:"memory",text:`茉莉茶 filler ${i}`,source:{origin:"manual",occurredAt:null,note:null}}));
 for(const state of fillers)await reader.append({userId,subjectId:"G",states:[state]});
 const candidates=await reader.listForClaudeRecall({userId,subjectId:"G",query:"茉莉茶"});
 assert.ok(candidates.length>256);assert.ok(candidates.some(s=>s.id===tea));
 const input={userId,sessionId:"s",query:"茉莉茶",excludeIds:[tea,hidden]};
 assert.deepEqual((await service.recall(input)).memory_ids,(await original.recall(input)).memory_ids);
 // Compare data transfer and elapsed time, never assert noisy timing thresholds.
 for(const size of [1000,30000]){
  const current=Number((await db.select({id:runtimeSubjectStates.id}).from(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId,userId))).length);
  for(let n=current;n<size;n+=500){
   const rows=Array.from({length:Math.min(500,size-n)},(_,j)=>{
    const s=createMindState({id:randomUUID(),userId,subjectId:"G",kind:"memory",text:`unrelated archive entry ${n+j}`,source:{origin:"manual",occurredAt:null,note:null}});
    return {id:s.id,userId,subjectId:"G",kind:s.kind,text:s.text,payload:s.payload,envelope:s.envelope as unknown as Record<string,unknown>,scopeApplicability:"global",settlementStatus:"settled",pathStatus:"current",validityStatus:"valid"};
   });await db.insert(runtimeSubjectStates).values(rows);
  }
  const measure=async(fn:()=>Promise<unknown>)=>{const start=performance.now();const result=await fn();return {ms:Math.round((performance.now()-start)*10)/10,result};};
  const old=await measure(()=>original.recall({...input,query:"cafe"}));
  const fresh=await measure(()=>service.recall({...input,query:"cafe"}));
  assert.deepEqual((fresh.result as {memory_ids:string[]}).memory_ids,(old.result as {memory_ids:string[]}).memory_ids);
  const reduced=await reader.listForClaudeRecall({userId,subjectId:"G",query:"cafe"});
  assert.equal(reduced.length,1);t.diagnostic(JSON.stringify({syntheticRows:size,fullReadMs:old.ms,filteredReadMs:fresh.ms,returnedRows:reduced.length}));
 }
});
