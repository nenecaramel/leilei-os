import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, runtimeSubjectStates } from "../src/database/schema.js";
import { createMindState } from "../src/domains/runtime/mind/mind-writer.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state/subject-state-runtime-repository.js";
import { mindLshBands } from "../src/domains/runtime/mind/claude-code-semantic-lsh.js";

const url = process.env.DATABASE_URL;
const enabled = process.env.RUN_CLAUDE_CODE_MIND_DATABASE_TEST === "1" && Boolean(url) &&
  ["127.0.0.1", "localhost"].includes(new URL(url!).hostname) && /test/.test(new URL(url!).pathname);

// Requires migrations 0110/0111 on an isolated PostgreSQL database; never production.
test("indexed discovery scales past 256 Memory and tracks edits/hide/delete", {skip: !enabled}, async t => {
  const database = createDatabase(url!, {ssl:false});
  const db = database.db;
  const userId = randomUUID();
  t.after(async () => {
    try {
      await db.delete(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId,userId));
      await db.delete(users).where(eq(users.id,userId));
    } finally {await database.close();}
  });
  await db.insert(users).values({
    id:userId,email:`mind-index-${userId}@example.test`,displayName:"Mind index test",
  });
  const memory = (text:string) => createMindState({
    id:randomUUID(),userId,subjectId:"G",kind:"memory",text,
    source:{origin:"manual",occurredAt:null,note:null},
  });
  const states = Array.from({length:300},(_,i)=>memory(`历史记录 第${i}条 普通事件`));
  const target=memory("最喜欢柠檬黄色的头发");
  const hidden=memory("隐藏的柠檬黄色记忆");
  hidden.envelope.scope.visibility="hidden_system";
  const invalid=memory("无效的柠檬黄色记忆");
  invalid.envelope.status.validityStatus="invalidated";
  const port=new DrizzleSubjectStateRuntimePort(db);
  // Place the target in the middle of >256 rows: recent/oldest coverage alone
  // must not accidentally make this indexed regression pass.
  await port.append({userId,subjectId:"G",states:[
    ...states.slice(0,150),target,...states.slice(150),hidden,invalid,
  ]});
  const find=(q:string,excluded:string[]=[])=>port.searchGlobalRecallCandidates({
    userId,subjectId:"G",query:q,excludeIds:excluded,
  });
  const first=await find("喜欢柠檬黄");
  assert.ok(first.length<=256);
  assert.ok(first.some(x=>x.id===target.id));
  assert.ok(!first.some(x=>x.id===hidden.id || x.id===invalid.id));
  const excluded=await find("喜欢柠檬黄",[target.id]);
  assert.ok(!excluded.some(x=>x.id===target.id));
  await db.update(runtimeSubjectStates).set({text:"最喜欢蓝色的头发"})
    .where(eq(runtimeSubjectStates.id,target.id));
  const edited=await find("喜欢蓝色");
  assert.ok(edited.some(x=>x.id===target.id));
  await db.delete(runtimeSubjectStates).where(eq(runtimeSubjectStates.id,target.id));
  assert.ok(!(await find("喜欢蓝色")).some(x=>x.id===target.id));
});

test("semantic index finds a middle-history paraphrase without lexical overlap, and drops hidden rows", {skip: !enabled},async t=>{
  const database=createDatabase(url!,{ssl:false});
  const db=database.db, userId=randomUUID();
  t.after(async()=>{
    try{
      await db.delete(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId,userId));
      await db.delete(users).where(eq(users.id,userId));
    }finally{await database.close();}
  });
  await db.insert(users).values({
    id:userId,email:`mind-semantic-${userId}@example.test`,displayName:"Mind semantic test",
  });
  const memory=(text:string)=>createMindState({
    id:randomUUID(),userId,subjectId:"G",kind:"memory",text,
    source:{origin:"manual",occurredAt:null,note:null},
  });
  const earlier=Array.from({length:150},(_,i)=>memory(`早年的日常信息 ${i}`));
  const target=memory("过去约定总被违背，后来因此产生争执");
  const later=Array.from({length:150},(_,i)=>memory(`后来的日常信息 ${i}`));
  const port=new DrizzleSubjectStateRuntimePort(db);
  await port.append({userId,subjectId:"G",states:[...earlier,target,...later]});
  await db.update(runtimeSubjectStates).set({createdAt:new Date("2026-09-01T00:00:00Z")})
    .where(inArray(runtimeSubjectStates.id,earlier.map(m=>m.id)));
  await db.update(runtimeSubjectStates).set({createdAt:new Date("2026-09-15T00:00:00Z")})
    .where(eq(runtimeSubjectStates.id,target.id));
  await db.update(runtimeSubjectStates).set({createdAt:new Date("2026-10-01T00:00:00Z")})
    .where(inArray(runtimeSubjectStates.id,later.map(m=>m.id)));
  const query="说过的话一直不兑现";
  const lexical=await port.searchGlobalRecallCandidates({
    userId,subjectId:"G",query,excludeIds:[],
  });
  assert.ok(!lexical.some(row=>row.id===target.id),"no shared words and no time coverage");
  const vector=Array.from({length:384},(_,i)=>Math.sin(i*.097)+.31*Math.cos(i*.41));
  const buckets=mindLshBands(vector);
  const inserts=buckets.map((bucket,band)=>sql`(
    ${target.id}::uuid,${userId}::uuid,'G',${band},${bucket},${"a".repeat(64)}
  )`);
  await db.execute(sql`INSERT INTO runtime_mind_recall_semantic_bands
    (state_id,user_id,subject_id,band,bucket,content_sha256)
    VALUES ${sql.join(inserts,sql`,`)}`);
  const semantic=new DrizzleSubjectStateRuntimePort(db,{
    embedQuery:async()=>vector,
  });
  const selected=await semantic.searchGlobalRecallCandidates({
    userId,subjectId:"G",query,excludeIds:[],
  });
  assert.ok(selected.some(row=>row.id===target.id),"semantic LSH retrieves paraphrase");
  assert.ok(!(await semantic.searchGlobalRecallCandidates({
    userId,subjectId:"G",query,excludeIds:[target.id],
  })).some(row=>row.id===target.id));
  await db.update(runtimeSubjectStates).set({
    envelope:{...target.envelope,scope:{...target.envelope.scope,visibility:"hidden_system"}},
  }).where(eq(runtimeSubjectStates.id,target.id));
  assert.ok(!(await semantic.searchGlobalRecallCandidates({
    userId,subjectId:"G",query,excludeIds:[],
  })).some(row=>row.id===target.id));
  const remaining=await db.execute(sql`SELECT state_id FROM runtime_mind_recall_semantic_bands
    WHERE state_id=${target.id}::uuid`);
  assert.equal(remaining.length,0,"SQL trigger invalidates all old vector buckets");
});
