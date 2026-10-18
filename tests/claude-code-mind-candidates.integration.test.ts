import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, runtimeSubjectStates } from "../src/database/schema.js";
import { createMindState } from "../src/domains/runtime/mind/mind-writer.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state/subject-state-runtime-repository.js";

const url = process.env.DATABASE_URL;
const enabled = process.env.RUN_CLAUDE_CODE_MIND_DATABASE_TEST === "1" && Boolean(url) &&
  ["127.0.0.1", "localhost"].includes(new URL(url!).hostname) && /test/.test(new URL(url!).pathname);

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
  const hidden=memory("隐藏的柠檬黄色记忆");
  hidden.envelope.scope.visibility="hidden_system";
  const invalid=memory("无效的柠檬黄色记忆");
  invalid.envelope.status.validityStatus="invalidated";
  const port=new DrizzleSubjectStateRuntimePort(db);
  await port.append({userId,subjectId:"G",states:[...states,target,hidden,invalid]});
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
