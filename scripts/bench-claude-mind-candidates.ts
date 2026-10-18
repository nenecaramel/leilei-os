/**
 * Claude Code only. Run on an attested LOCAL PostgreSQL 18 Docker test DB
 * AFTER the PR's migration 0110. Never run against Railway or real Memory.
 * Measures the new SQL discovery against the 16 Oct in-process lexical scan
 * using the same synthetic corpus. No user content or credentials are logged.
 *
 * MIND_BENCH_COUNT=10000 pnpm exec tsx scripts/bench-claude-mind-candidates.ts
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, runtimeSubjectStates } from "../src/database/schema.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state/subject-state-runtime-repository.js";
import { createMindState } from "../src/domains/runtime/mind/mind-writer.js";
import { breathLexicalScore } from "../src/domains/runtime/breath/breath-recall.js";
import { isolatedPostgresTarget, verifyIsolatedPostgresTarget } from "./isolated-postgres-target.mjs";

const count = Number(process.env.MIND_BENCH_COUNT ?? 10000);
if (!Number.isInteger(count) || count < 1000 || count > 30000)
  throw new Error("MIND_BENCH_COUNT must be 1000..30000");
if (!process.env.DATABASE_URL || !process.env.ISOLATED_POSTGRES_CONTAINER_ID)
  throw new Error("LOCAL_ATTESTED_TEST_DATABASE_REQUIRED");
const target = isolatedPostgresTarget(process.env.DATABASE_URL);
if (!target.containerId) throw new Error("LOCAL_DOCKER_ID_REQUIRED");
await verifyIsolatedPostgresTarget(target);

const {db,close} = createDatabase(target.url, {ssl:false});
const userId = randomUUID();
const mk = (text: string) => createMindState({
  id: randomUUID(), userId, subjectId:"G", kind:"memory", text,
  source:{origin:"manual" as const, occurredAt:null, note:null},
});
const targets = [
  mk("衣服颜色十分鲜艳"),            // shared two-character Chinese anchor only
  mk("最喜欢柠檬黄色的头发"),        // longer literal match
  mk("以前聊过的面包发酵时间"),      // separate relevant topic
];
const filler = (i:number) => mk(`历史档案编号${i}，普通生活工作事项`);
const times = (fn:()=>Promise<unknown>,runs=9) =>
  Promise.all(Array.from({length:runs},()=>fn().then(()=>performance.now())));
const percentile=(values:number[],p:number)=>{
  const s=[...values].sort((a,b)=>a-b);
  return Math.round((s[Math.max(0,Math.ceil(s.length*p)-1)]??0)*10)/10;
};
try {
  await db.insert(users).values({
    id:userId,email:`recall-perf-${userId}@example.test`,displayName:"Recall performance fixture",
  });
  // Appending through the real Memory port catches schema/eligibility regressions.
  await (async()=>{
    let batch=[...targets];
    for(let i=0;i<count;i++){
      batch.push(filler(i));
      if(batch.length>=200){await db.insert(runtimeSubjectStates).values(batch.map(row=>({
        id:row.id, userId, subjectId:"G",kind:row.kind, text:row.text,
        payload:row.payload, envelope:row.envelope,
        scopeApplicability:"global",settlementStatus:"settled",
        pathStatus:"current",validityStatus:"valid",
      }))); batch=[];}
    }
    if(batch.length)await db.insert(runtimeSubjectStates).values(batch.map(row=>({
      id:row.id, userId, subjectId:"G",kind:row.kind,text:row.text,
      payload:row.payload,envelope:row.envelope,
      scopeApplicability:"global",settlementStatus:"settled",
      pathStatus:"current",validityStatus:"valid",
    })));
  })();
  const port = new DrizzleSubjectStateRuntimePort(db);
  const queries = [
    {tag:"two_char",query:"你喜欢哪种颜色",target:targets[0]!.id},
    {tag:"long_literal",query:"喜欢柠檬黄",target:targets[1]!.id},
    {tag:"baking",query:"面包发酵多久",target:targets[2]!.id},
    {tag:"negative",query:"XylophoneNebulaQuasar",target:null},
  ];
  // Warm and measure query-round-trips, not synthetic timers without SQL.
  for (const q of queries) {
    const sqlMs:number[]=[]; const legacyMs:number[]=[];
    let hits=0,returned=0;
    for(let i=0;i<9;i++){
      const sqlStart=performance.now();
      const rows=await port.searchGlobalRecallCandidates({
        userId,subjectId:"G",query:q.query,excludeIds:[],
      });
      sqlMs.push(performance.now()-sqlStart);
      if(rows.length>256)throw new Error("CANDIDATE_LIMIT_EXCEEDED");
      if(q.target!==null && rows.some(x=>x.id===q.target))hits++;
      returned=rows.length;
      const oldStart=performance.now();
      const all=await port.list({
        userId, subjectId:"G", conversationId:"claude-code:benchmark", globalOnly:true,
      });
      // Compare actual old lexical scoring; this is a performance baseline only,
      // not a reproduction of all old lifecycle/coverage candidate logic.
      all.map(m=>breathLexicalScore(q.query,m.text??""));
      legacyMs.push(performance.now()-oldStart);
    }
    if(q.target!==null && hits!==9)throw new Error(`MISSING_EXPECTED_ANCHOR:${q.tag}`);
    if(q.target===null && returned!==0)throw new Error("UNRELATED_CANDIDATES");
    console.log(JSON.stringify({
      case:q.tag,corpus_count:count+targets.length,candidates:returned,
      query_hit_rounds:hits,sql_p50_ms:percentile(sqlMs,.5),
      sql_p95_ms:percentile(sqlMs,.95),
      old_read_and_lexical_p50_ms:percentile(legacyMs,.5),
      old_read_and_lexical_p95_ms:percentile(legacyMs,.95),
    }));
  }
}finally{
  try{
    await db.delete(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId,userId));
    await db.delete(users).where(eq(users.id,userId));
  }finally{await close();}
}
