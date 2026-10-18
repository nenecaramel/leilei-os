/**
 * Actual on-device E5 + ritrieve smoke/latency check on SYNTHETIC candidates.
 * No personal backup, Mind records, network API requests, DB, Hook installation
 * or Railway needed. Public model dependencies must already be prepared.
 *
 * pnpm exec tsx scripts/mind-hybrid2-synthetic-mac-smoke.ts
 */
import { performance } from "node:perf_hooks";
import { LocalHybridMindRecallScorer } from "../src/domains/runtime/mind/local-hybrid-mind-recall.js";

const id = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const targets = [
  { stateId:id(1), kind:"memory" as const,
    text:"测试人物的自行车是红色的，周末常常骑自行车。" },
  { stateId:id(2), kind:"memory" as const,
    text:"测试人物计划春天去成都旅行，主要是想看大熊猫。" },
  { stateId:id(3), kind:"memory" as const,
    text:"测试人物在做面包时使用酵母，注意控制面团温度和发酵时间。" },
];
const fillers = Array.from({length:253},(_,i)=>({
  stateId:id(i+4),kind:"memory" as const,
  text:`普通档案编号${i+1}：市民服务中心整理了公共图书馆的旧报纸、文件和办公设备。`,
}));
const tests = [
  {tag:"bicycle",query:"测试人物的自行车是什么颜色？",targetId:id(1)},
  {tag:"travel",query:"测试人物打算去哪里看熊猫？",targetId:id(2)},
  {tag:"baking",query:"做面包需要注意哪些发酵条件？",targetId:id(3)},
  {tag:"unrelated",query:"月球背面的岩石有什么化学成分？",targetId:null},
];
function percentile(numbers:number[],p:number):number {
  const ordered=[...numbers].sort((a,b)=>a-b);
  return Math.round((ordered[Math.max(0,Math.ceil(ordered.length*p)-1)]??0)*10)/10;
}
const scorer=new LocalHybridMindRecallScorer();
try {
  const warmupStart=performance.now();
  await scorer.warmup();
  console.log(JSON.stringify({stage:"MODELS_READY",warmup_ms:Math.round(performance.now()-warmupStart)}));

  for(const size of [16,64,128,256]){
    const candidates=[...targets,...fillers.slice(0,size-targets.length)];
    const samples:number[]=[];
    let positiveHits=0;
    let irrelevantReturns=0;
    let maxSelected=0;
    for(const test of tests){
      const start=performance.now();
      const selected=await scorer.scoreCandidatesHybrid({query:test.query,candidates});
      const elapsed=performance.now()-start;
      samples.push(elapsed);
      if(selected.selectedIds.length>2
          || new Set(selected.selectedIds).size!==selected.selectedIds.length
          || selected.selectedIds.some(x=>!candidates.some(c=>c.stateId===x)))
        throw new Error("SELECTOR_CONTRACT_FAILED");
      if(test.targetId!==null && selected.selectedIds.includes(test.targetId))positiveHits++;
      if(test.targetId===null)irrelevantReturns=selected.selectedIds.length;
      maxSelected=Math.max(maxSelected,selected.selectedIds.length);
      console.log(JSON.stringify({
        stage:"CASE",size,case:test.tag,elapsed_ms:Math.round(elapsed*10)/10,
        returned:selected.selectedIds.length,target_selected:test.targetId===null?null:
          selected.selectedIds.includes(test.targetId),
      }));
    }
    console.log(JSON.stringify({
      stage:"SUMMARY",size,positive_hits:positiveHits,positive_cases:3,
      unrelated_returns:irrelevantReturns,max_returned:maxSelected,
      p50_ms:percentile(samples,.5),p95_ms:percentile(samples,.95),
      p95_under_local_1000ms_budget:percentile(samples,.95)<1000,
      caveat:"4 queries per size only; synthetic data. No Railway/Hook network latency.",
    }));
  }
  console.log("SYNTHETIC_MAC_DUAL_MODEL_SMOKE_FINISHED");
}catch(error){
  const reason=error instanceof Error && /^[A-Z_]{3,70}$/.test(error.message)?
    error.message:"DUAL_MODEL_TEST_FAILED";
  console.error("SYNTHETIC_MAC_DUAL_MODEL_SMOKE_FAILED "+reason);
  process.exitCode=1;
}finally{
  await scorer.close().catch(()=>undefined);
}
