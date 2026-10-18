/**
 * Offline exploratory calibration on completely synthetic Mind data.
 *
 * Run on the Mac that already has the local model installed:
 *   pnpm exec tsx scripts/mind-ritrieve-negative-calibration.ts
 *
 * No token, Railway, DB, personal memory, or production config is used.
 * These hand-written examples are exploratory, not a representative
 * held-out evaluation or a basis for automatic production promotion.
 */
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { LocalRitrieveBreathSemanticScorer } from "../src/domains/runtime/breath/local-ritrieve-embedding.js";

type Label = "promise" | "baking" | "none";
type LabeledQuery = {tag: string; query: string; relevant: Label};
type Observation = {
  tag: string;
  label: Label;
  expectedId: string | null;
  hits: Array<{stateId: string; score: number}>;
  baseFloor: number;
  queryMs: number;
  rawTopScore: number | null;
  expectedScore: number | null;
  rawTopCorrect: boolean | null;
};
const memories = [
  {stateId: "11111111-1111-4111-8111-111111111111", text: "做面包时面团需要充分发酵。", label: "baking"},
  {stateId: "22222222-2222-4222-8222-222222222222", text: "过去曾经因为承诺被反复打破而发生争执。", label: "promise"},
] as const;

const cases: LabeledQuery[] = [
  {tag:"promise_01",query:"我还是在意以前答应过的事",relevant:"promise"},
  {tag:"promise_02",query:"当一个人反复食言，我们为什么会争执",relevant:"promise"},
  {tag:"promise_03",query:"说好要做的事情总不兑现",relevant:"promise"},
  {tag:"promise_04",query:"谈谈被违背的承诺",relevant:"promise"},
  {tag:"promise_05",query:"他失约以后我们又吵起来了",relevant:"promise"},
  {tag:"promise_06",query:"为什么失信会伤害关系",relevant:"promise"},
  {tag:"promise_07",query:"上次说过不再失信的约定",relevant:"promise"},
  {tag:"promise_08",query:"之前答应我的事情没做到",relevant:"promise"},
  {tag:"promise_09",query:"老是说到做不到怎么办",relevant:"promise"},
  {tag:"promise_10",query:"我们因反复失约发生争吵",relevant:"promise"},
  {tag:"baking_01",query:"怎么让面包发得更好",relevant:"baking"},
  {tag:"baking_02",query:"面团需要发酵多长时间",relevant:"baking"},
  {tag:"baking_03",query:"揉完的面团怎样醒发",relevant:"baking"},
  {tag:"baking_04",query:"发酵不足的面包会怎样",relevant:"baking"},
  {tag:"baking_05",query:"酵母发面有哪些注意事项",relevant:"baking"},
  {tag:"baking_06",query:"做吐司时面团的发酵温度",relevant:"baking"},
  {tag:"baking_07",query:"面团为什么要二次发酵",relevant:"baking"},
  {tag:"baking_08",query:"如何判断面团是否发酵充分",relevant:"baking"},
  {tag:"baking_09",query:"面包蓬松的关键是什么",relevant:"baking"},
  {tag:"baking_10",query:"烘焙前面胚如何醒发",relevant:"baking"},
  {tag:"negative_01",query:"太阳系里有哪些行星",relevant:"none"},
  {tag:"negative_02",query:"如何给电脑安装打印机",relevant:"none"},
  {tag:"negative_03",query:"今天东京会下雨吗",relevant:"none"},
  {tag:"negative_04",query:"猫咪每晚吃多少粮",relevant:"none"},
  {tag:"negative_05",query:"泰勒公式有什么用途",relevant:"none"},
  {tag:"negative_06",query:"量子力学是什么",relevant:"none"},
  {tag:"negative_07",query:"怎么预订周末的酒店",relevant:"none"},
  {tag:"negative_08",query:"请解释 TCP 三次握手",relevant:"none"},
  {tag:"negative_09",query:"把三公里换算成米",relevant:"none"},
  {tag:"negative_10",query:"如何修剪玫瑰花",relevant:"none"},
  {tag:"negative_11",query:"下载文件总显示网络错误",relevant:"none"},
  {tag:"negative_12",query:"冰川是怎么形成的",relevant:"none"},
  {tag:"negative_13",query:"足球的越位规则是什么",relevant:"none"},
  {tag:"negative_14",query:"帮我翻译这个英文段落",relevant:"none"},
  {tag:"negative_15",query:"怎么做清蒸鲈鱼",relevant:"none"},
  {tag:"negative_16",query:"冥王星为什么不是行星",relevant:"none"},
  {tag:"negative_17",query:"做蛋糕之前烤箱要预热吗",relevant:"none"},
  {tag:"negative_18",query:"我们刚才讨论过的是什么",relevant:"none"},
  {tag:"negative_19",query:"怎么给朋友写生日贺卡",relevant:"none"},
  {tag:"negative_20",query:"如何用积分计算面积",relevant:"none"},
];

function rounded(value: number): number { return Number(value.toFixed(4)); }
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a,b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length*fraction) - 1)] ?? 0);
}

const scorer = new LocalRitrieveBreathSemanticScorer();
try {
  const warmupStarted = performance.now();
  await scorer.warmup();
  const warmupMs = Math.round(performance.now() - warmupStarted);

  const indexStarted = performance.now();
  await scorer.replaceSnapshot({
    version: createHash("sha256").update(JSON.stringify(memories)).digest("hex"),
    memories: memories.map(({stateId,text}) => ({stateId,text})),
  });
  const indexMs = Math.round(performance.now() - indexStarted);

  const observations: Observation[] = [];
  for (const c of cases) {
    const started = performance.now();
    const r = await scorer.searchSnapshot(c.query, 48);
    const queryMs = Math.round(performance.now() - started);
    if (r.count !== memories.length) throw new Error("Incorrect synthetic index size.");
    const expectedId = memories.find(m => m.label === c.relevant)?.stateId ?? null;
    const top = r.hits[0];
    observations.push({
      tag:c.tag, label:c.relevant, expectedId, hits:r.hits,
      baseFloor:r.floor ?? 0.68, queryMs,
      rawTopScore: top ? rounded(top.score) : null,
      expectedScore:expectedId ? rounded(r.hits.find(hit => hit.stateId === expectedId)?.score ?? 0) : null,
      rawTopCorrect: c.relevant !== "none" ? top?.stateId === expectedId : null,
    });
  }

  const thresholds = [0.68, 0.72, 0.74, 0.76, 0.78, 0.80, 0.82, 0.84, 0.86, 0.88];
  const sweeps = thresholds.map(threshold => {
    let positivesSelected = 0, positivesCorrectTop = 0, positivesCorrectInTop4 = 0;
    let negativesEmpty = 0, negativesNonempty = 0, wrongPositiveMemorySelections = 0;
    for (const item of observations) {
      const eligible = item.hits
        .filter(hit => hit.score >= Math.max(threshold, item.baseFloor)).slice(0,4);
      if (item.label === "none") {
        if (eligible.length === 0) negativesEmpty++;
        else negativesNonempty++;
      } else {
        if (eligible.length > 0) positivesSelected++;
        if (eligible[0]?.stateId === item.expectedId) positivesCorrectTop++;
        if (eligible.some(hit => hit.stateId === item.expectedId)) positivesCorrectInTop4++;
        wrongPositiveMemorySelections += eligible.filter(hit => hit.stateId !== item.expectedId).length;
      }
    }
    return {
      min_score:threshold,
      positive_correct_top1:`${positivesCorrectTop}/20`,
      positive_correct_in_top4:`${positivesCorrectInTop4}/20`,
      positive_any_selected:`${positivesSelected}/20`,
      negatives_empty:`${negativesEmpty}/20`,
      negatives_wrongly_nonempty:negativesNonempty,
      wrong_positive_memory_selections:wrongPositiveMemorySelections,
    };
  });

  console.log(JSON.stringify({
    experiment:"synthetic_offline_ritrieve_threshold_sweep",
    cases:cases.length,positive_cases:20,negative_cases:20,
    warmup_ms:warmupMs,index_ms:indexMs,
    local_query_p50_ms:percentile(observations.map(item=>item.queryMs),0.5),
    local_query_p95_ms:percentile(observations.map(item=>item.queryMs),0.95),
    per_case:observations.map(item=>({
      id:item.tag,label:item.label,raw_top_score:item.rawTopScore,
      expected_score:item.expectedScore,raw_top_correct:item.rawTopCorrect,
      computed_floor:rounded(item.baseFloor),local_query_ms:item.queryMs,
    })),
    threshold_comparison:sweeps,
    conclusion:"EXPLORATORY_ONLY: Do not switch defaults based on two synthetic memories; require labeled real data and larger index validation.",
  },null,2));
} catch(error) {
  const name = error instanceof Error && /^[A-Za-z0-9_.-]{1,64}$/.test(error.name)
    ? error.name : "UNKNOWN";
  console.error(`Synthetic calibration failed: ${name}`);
  process.exitCode=1;
} finally {
  await scorer.close();
}
