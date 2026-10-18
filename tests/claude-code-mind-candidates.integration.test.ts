import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, runtimeSubjectStates } from "../src/database/schema.js";
import { createMindState } from "../src/domains/runtime/mind/mind-writer.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state/subject-state-runtime-repository.js";
import { breathLexicalScore, breathLexicalTokens } from "../src/domains/runtime/breath/breath-recall.js";

const url = process.env.DATABASE_URL;
const enabled = process.env.RUN_CLAUDE_CODE_MIND_DATABASE_TEST === "1" && Boolean(url) &&
  ["127.0.0.1", "localhost"].includes(new URL(url!).hostname) && /test/.test(new URL(url!).pathname);

test("Claude candidate lookup shares the 16 Oct lexical token rules", () => {
  const tokens = breathLexicalTokens("你喜欢哪种颜色");
  assert.ok(tokens.includes("颜色"), "Chinese two-character anchor is retained");
  assert.ok(tokens.includes("喜欢"), "Chinese two-character anchor is retained");
  assert.ok(tokens.includes("喜欢哪"), "Chinese three-character anchor is retained");
  assert.ok(!breathLexicalTokens("我们").includes("我们"),
    "Low-information bigrams stay excluded");
});

// Requires migration 0110 on an isolated PostgreSQL test database; never production.
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
  const twoCharacterOnly=memory("衣服颜色十分鲜艳");
  const hidden=memory("隐藏的柠檬黄色记忆");
  hidden.envelope.scope.visibility="hidden_system";
  const invalid=memory("无效的柠檬黄色记忆");
  invalid.envelope.status.validityStatus="invalidated";
  const port=new DrizzleSubjectStateRuntimePort(db);
  // Place the target among >256 rows to ensure one indexed search
  // reaches a relevant middle-history memory without recent/oldest filler.
  await port.append({userId,subjectId:"G",states:[
    ...states.slice(0,150),target,twoCharacterOnly,...states.slice(150),hidden,invalid,
  ]});
  const find=(q:string,excluded:string[]=[])=>port.searchGlobalRecallCandidates({
    userId,subjectId:"G",query:q,excludeIds:excluded,
  });
  const first=await find("喜欢柠檬黄");
  assert.ok(first.length<=256);
  assert.ok(first.some(x=>x.id===target.id));
  assert.ok(!first.some(x=>x.id===hidden.id || x.id===invalid.id));
  // The only shared Chinese anchor here is "颜色" (two characters).
  // The old three-character-only SQL excluded this middle-history Memory.
  const shortOverlap=await find("你喜欢哪种颜色");
  assert.ok(shortOverlap.some(x=>x.id===twoCharacterOnly.id),
    "Original two-character lexical matching must reach SQL candidates");
  const oldScoreSorted = [...shortOverlap].sort((a,b) =>
    breathLexicalScore("你喜欢哪种颜色",b.text??"") -
    breathLexicalScore("你喜欢哪种颜色",a.text??"") ||
    a.id.localeCompare(b.id));
  assert.deepEqual(shortOverlap.map(x=>x.id),oldScoreSorted.map(x=>x.id),
    "Bounded SQL candidates must use the actual 16 Oct lexical score order");
  assert.equal((await find("XylophoneNebulaQuasar")).length, 0,
    "unrelated historical memories must not fill the candidate budget");
  const excluded=await find("喜欢柠檬黄",[target.id]);
  assert.ok(!excluded.some(x=>x.id===target.id));
  await db.update(runtimeSubjectStates).set({text:"最喜欢蓝色的头发"})
    .where(eq(runtimeSubjectStates.id,target.id));
  const edited=await find("喜欢蓝色");
  assert.ok(edited.some(x=>x.id===target.id));
  await db.delete(runtimeSubjectStates).where(eq(runtimeSubjectStates.id,target.id));
  assert.ok(!(await find("喜欢蓝色")).some(x=>x.id===target.id));
});
