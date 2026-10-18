import assert from "node:assert/strict";
import test from "node:test";
import { LocalHybridMindRecallScorer } from "../src/domains/runtime/mind/local-hybrid-mind-recall.js";
import type { LocalE5BreathSemanticScorer } from "../src/domains/runtime/breath/local-e5-embedding.js";
import type { LocalRitrieveBreathSemanticScorer } from "../src/domains/runtime/breath/local-ritrieve-embedding.js";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const memories=[
  {stateId:id(1),kind:"memory" as const,text:"第一件真实记忆"},
  {stateId:id(2),kind:"memory" as const,text:"第二件真实记忆"},
];
function fake() {
  const e5Scores=new Map([[id(1),.94],[id(2),.92]]);
  const ritScores=new Map([[id(1),.77],[id(2),.74]]);
  let calls={e5:0,rit:0};
  let fail=false;
  const e5={
    score:async (input:{candidates:readonly {stateId:string}[]})=>{
      calls.e5++;
      if(fail)throw new Error("E5 failed.");
      return new Map(input.candidates.map(c=>[c.stateId,e5Scores.get(c.stateId)??.5]));
    },
  };
  const rit={
    score:async (input:{candidates:readonly {stateId:string}[]})=>{
      calls.rit++;
      return new Map(input.candidates.map(c=>[c.stateId,ritScores.get(c.stateId)??.5]));
    },
    warmup:async()=>undefined,
    close:async()=>undefined,
  };
  const scorer=new LocalHybridMindRecallScorer(
    e5 as unknown as Pick<LocalE5BreathSemanticScorer,"score">,
    rit as unknown as Pick<LocalRitrieveBreathSemanticScorer,"score"|"warmup"|"close">,
  );
  return {scorer,e5Scores,ritScores,calls,setFail:(value:boolean)=>{fail=value;}};
}

test("on-demand E5 plus ritrieve selects up to two without requiring a snapshot",async()=>{
  const f=fake();
  await f.scorer.warmup();
  const selected=await f.scorer.scoreCandidatesHybrid({query:"我们聊过什么",candidates:memories});
  assert.deepEqual(selected.selectedIds,[id(1),id(2)]);
  assert.equal(f.calls.e5,2); // warmup and on-demand
  assert.equal(f.calls.rit,1);
  await f.scorer.close();
});

test("negative or model disagreement never forces an unrelated Memory",async()=>{
  const f=fake();
  f.ritScores.set(id(1),.58);
  f.ritScores.set(id(2),.57);
  assert.deepEqual((await f.scorer.scoreCandidatesHybrid({
    query:"无关问题",candidates:memories,
  })).selectedIds,[]);
  await f.scorer.close();
});

test("second Memory needs independent model support",async()=>{
  const f=fake();
  f.ritScores.set(id(2),.69);
  assert.deepEqual((await f.scorer.scoreCandidatesHybrid({
    query:"相关回忆",candidates:memories,
  })).selectedIds,[id(1)]);
  await f.scorer.close();
});

test("per-turn 256 budget is not a stored Memory limit",async()=>{
  const f=fake();
  const query="记忆";
  await assert.rejects(f.scorer.scoreCandidatesHybrid({query,
    candidates:Array.from({length:257},(_,i)=>({
      stateId:id(i+1),kind:"memory" as const,text:"测试",
    }))}),/candidate set/);
  // A later request with a completely different subset works normally.
  const selection=await f.scorer.scoreCandidatesHybrid({query,candidates:memories});
  assert.deepEqual(selection.selectedIds,[id(1),id(2)]);
  await f.scorer.close();
});

test("reject malformed, duplicate or incomplete candidate scores",async()=>{
  const f=fake();
  await assert.rejects(f.scorer.scoreCandidatesHybrid({
    query:"test",candidates:[memories[0]!,memories[0]!],
  }),/candidate set/);
  await assert.rejects(f.scorer.scoreCandidatesHybrid({
    query:"test",candidates:[{...memories[0]!,text:""}],
  }),/candidate set/);
  f.e5Scores.delete(id(2));
  // A missing ID from E5 cannot be treated as an unrelated low score.
  // The fake supplies .5 for unknown IDs, so replace the missing result explicitly.
  const missingScorer=new LocalHybridMindRecallScorer({
    score:async()=>new Map([[id(1),.94]]),
  } as unknown as Pick<LocalE5BreathSemanticScorer,"score">,{
    score:async()=>new Map([[id(1),.77],[id(2),.74]]),
    warmup:async()=>undefined,close:async()=>undefined,
  } as unknown as Pick<LocalRitrieveBreathSemanticScorer,"score"|"warmup"|"close">);
  await assert.rejects(missingScorer.scoreCandidatesHybrid({
    query:"test",candidates:memories,
  }),/Incomplete/);
  await missingScorer.close();
  await f.scorer.close();
});

test("E5 failure leaves scorer available for future requests after recovery",async()=>{
  const f=fake();
  f.setFail(true);
  await assert.rejects(f.scorer.scoreCandidatesHybrid({
    query:"test",candidates:memories,
  }),/E5 failed/);
  f.setFail(false);
  assert.deepEqual((await f.scorer.scoreCandidatesHybrid({
    query:"test",candidates:memories,
  })).selectedIds,[id(1),id(2)]);
  await f.scorer.close();
});
