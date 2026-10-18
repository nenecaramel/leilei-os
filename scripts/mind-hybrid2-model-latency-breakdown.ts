/**
 * On-device model breakdown for a first-seen candidate set.
 * Synthetic data only; no Mind backup, Railway, Hook or database.
 * Reuses the same E5 + ritrieve classes as the Claude-only hybrid scorer.
 *
 * pnpm exec tsx scripts/mind-hybrid2-model-latency-breakdown.ts
 */
import { performance } from "node:perf_hooks";
import { LocalE5BreathSemanticScorer } from "../src/domains/runtime/breath/local-e5-embedding.js";
import { LocalRitrieveBreathSemanticScorer } from "../src/domains/runtime/breath/local-ritrieve-embedding.js";

const e5 = new LocalE5BreathSemanticScorer();
const ritrieve = new LocalRitrieveBreathSemanticScorer();
const sizes = [16, 64, 128, 256] as const;
const rounds = ["cold", "warm_repeat"] as const;

async function timeScore(
  label: string,
  scorer: {score(input: {
    query: string;
    candidates: readonly {stateId:string;kind:"memory";text:string}[];
  }): Promise<ReadonlyMap<string,number>>},
  input: {
    query:string;
    candidates:readonly {stateId:string;kind:"memory";text:string}[];
  },
) {
  const begin = performance.now();
  const scores = await scorer.score(input);
  const elapsed = performance.now()-begin;
  if (scores.size !== input.candidates.length ||
      input.candidates.some(c => !scores.has(c.stateId))) {
    throw new Error("INCOMPLETE_MODEL_SCORES");
  }
  return {label,elapsed_ms:Math.round(elapsed*10)/10};
}

try {
  const started=performance.now();
  await Promise.all([
    e5.score({
      query:"测试服务准备",
      candidates:[{stateId:"warmup",kind:"memory",text:"模型就绪"}],
    }),
    ritrieve.warmup(),
  ]);
  console.log(JSON.stringify({stage:"MODELS_READY",
    warmup_ms:Math.round(performance.now()-started)}));

  for (const size of sizes) {
    // All memory passages are new for this batch; repeats reuse only this batch.
    const candidates=Array.from({length:size},(_,i)=>({
      stateId:`00000000-0000-4000-8000-${String(i+size*1000).padStart(12,"0")}`,
      kind:"memory" as const,
      text:`独立模拟记录第${size}-${i}条：这里记录普通公共设施、城市交通、植物栽培和每周日程安排。`,
    }));
    const input={query:"如何安排城市交通与植物种植记录？",candidates};
    for (const round of rounds) {
      const begin=performance.now();
      const [e5Result,ritResult] = await Promise.all([
        timeScore("E5",e5,input),
        timeScore("ritrieve",ritrieve,input),
      ]);
      console.log(JSON.stringify({
        stage:"MODEL_LATENCY",size,round,
        e5_ms:e5Result.elapsed_ms,
        ritrieve_ms:ritResult.elapsed_ms,
        combined_wall_ms:Math.round((performance.now()-begin)*10)/10,
        within_hook_local_1000ms:performance.now()-begin<1000,
      }));
    }
  }
  console.log("DUAL_MODEL_LATENCY_BREAKDOWN_FINISHED");
} catch(error) {
  const code=error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message)
    ?error.message:"DUAL_MODEL_LATENCY_BREAKDOWN_FAILED";
  console.error(code);
  process.exitCode=1;
} finally {
  await ritrieve.close().catch(()=>undefined);
}
