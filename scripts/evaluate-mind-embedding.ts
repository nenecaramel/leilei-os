/**
 * Offline semantic model comparison. No account/DB access and no telemetry.
 *
 * Usage:
 * pnpm exec tsx scripts/evaluate-mind-embedding.ts /private/path/mind-labels.json
 *
 * JSON: {"memories":[{"id":"uuid","text":"..."}],
 * "cases":[{"query":"...","relevant_ids":["uuid"]}]}
 * NEVER commit personal eval data.
 */
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { LocalE5BreathSemanticScorer } from "../src/domains/runtime/breath/local-e5-embedding.js";
import { LocalRitrieveBreathSemanticScorer } from "../src/domains/runtime/breath/local-ritrieve-embedding.js";
import type { BreathSemanticScorer } from "../src/domains/runtime/breath/breath-semantic-recall.js";

const schema = z.object({
  memories: z.array(z.object({id: z.string().uuid(), text: z.string().min(1).max(2000)}).strict()).min(1).max(30000),
  cases: z.array(z.object({
    query: z.string().min(1).max(16000),
    relevant_ids: z.array(z.string().uuid()).max(30),
  }).strict()).min(1).max(500),
}).strict();

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a,b) => a-b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length*p)-1)]!;
}

async function evaluate(
  name: string, scorer: BreathSemanticScorer, floor: number,
  fixture: z.infer<typeof schema>,
) {
  let expected = 0;
  let hits = 0;
  let wrong = 0;
  let returned = 0;
  let negative = 0;
  let negativeCorrect = 0;
  const latencies: number[] = [];
  for (const item of fixture.cases) {
    const started = performance.now();
    const scores = new Map<string,number>();
    for (let offset = 0; offset < fixture.memories.length; offset += 128) {
      const part = fixture.memories.slice(offset, offset+128);
      const batch = await scorer.score({
        query: item.query,
        candidates: part.map(memory => ({stateId:memory.id,kind:"memory" as const,text:memory.text})),
      });
      for (const [id, score] of batch) scores.set(id,score);
    }
    const selected = [...scores].filter(([,score])=>score>floor)
      .sort((a,b)=>b[1]-a[1]).slice(0,4).map(([id])=>id);
    latencies.push(performance.now()-started);
    const relevant = new Set(item.relevant_ids);
    if (relevant.size === 0) {
      negative++;
      if (selected.length === 0) negativeCorrect++;
    }
    expected += relevant.size;
    returned += selected.length;
    for (const id of selected) {
      if (relevant.has(id)) hits++;
      else wrong++;
    }
  }
  return {
    name, cases:fixture.cases.length,
    recall_at_4:expected?Number((hits/expected).toFixed(4)):null,
    incorrect_injection_fraction:returned?Number((wrong/returned).toFixed(4)):0,
    negative_query_empty_rate:negative?Number((negativeCorrect/negative).toFixed(4)):null,
    latency_p50_ms:Math.round(percentile(latencies,.5)),
    latency_p95_ms:Math.round(percentile(latencies,.95)),
  };
}

const filepath = process.argv[2];
if (!filepath) throw new Error("Provide an on-device private JSON fixture path.");
const fixture = schema.parse(JSON.parse(await readFile(filepath,"utf8")));
if (new Set(fixture.memories.map(x=>x.id)).size !== fixture.memories.length)
  throw new Error("Duplicate memory IDs in evaluation fixture.");
const e5 = new LocalE5BreathSemanticScorer();
const ritrieve = new LocalRitrieveBreathSemanticScorer();
try {
  const e5Result = await evaluate("E5-small", e5, .80, fixture);
  const newResult = await evaluate("ritrieve-zh", ritrieve, .68, fixture);
  process.stdout.write(JSON.stringify({e5:e5Result,ritrieve:newResult},null,2)+"\n");
} finally {
  await ritrieve.close();
}
