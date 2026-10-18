/**
 * LOCAL-ONLY before/after retrieval comparison on LeileiOS Full Backup v4.
 *
 * pnpm exec tsx scripts/mind-real-before-after.ts "/private/path/leileios-full-backup_*.json"
 *
 * No DB access, tokens, personal-data uploads, output files or production changes.
 * E5 may retrieve public model weights if the local model cache is incomplete.
 * Runs original local E5 scorer and new ritrieve snapshot index against the
 * SAME sampled eligible Mind Memory records and SAME automatically derived
 * query probes. Labels derived from message provenance are WEAK ground truth;
 * self-quote probes are trivial controls. Generic probes are unlabelled.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { snapshotMemories } from "../src/domains/runtime/mind/mind-snapshot-version.js";
import { LocalE5BreathSemanticScorer } from "../src/domains/runtime/breath/local-e5-embedding.js";
import { LocalRitrieveBreathSemanticScorer } from "../src/domains/runtime/breath/local-ritrieve-embedding.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state/subject-state-contract.js";
import type { BreathSemanticCandidate } from "../src/domains/runtime/breath/breath-semantic-recall.js";

type Json = Record<string, unknown>;
type Memory = { id: string; text: string; sourceMessageIds: string[] };
type Probe = { tag: string; query: string; relevantIds: string[]; type: "source_linked" | "self_quote" | "generic_unlabelled" };
type Score = { id: string; score: number };
type Outcome = { top1: number; at4: number; total: number; returned: number; duration: number; kind: Probe["type"] };
const record = (x: unknown): x is Json => Boolean(x) && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === "string";
const uuid = (x: unknown): x is string => str(x) && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
function pctl(xs: readonly number[], fraction: number): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x,y) => x-y);
  return Math.round(a[Math.min(a.length-1, Math.ceil(fraction*a.length)-1)]!);
}
function hash(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function readMemories(document: unknown): {memories: Memory[]; messages: Map<string,Json>} {
  if (!record(document) || document.schema_version !== 4 || !record(document.data)
    || !Array.isArray(document.data.mind)) throw new Error("Expected LeileiOS Full Backup v4 with data.mind.");
  const rows = document.data.mind as unknown[];
  const all: SubjectStateWrite[] = [];
  const sources = new Map<string, string[]>();
  for (const raw of rows) {
    if (!record(raw) || raw.kind !== "memory" || raw.subject_id !== "G"
      || !uuid(raw.id) || !str(raw.text) || !record(raw.envelope)) continue;
    const envelope = raw.envelope;
    if (!record(envelope.scope) || !record(envelope.status)) continue;
    // This function performs the exact full eligibility check used by the new snapshot API.
    all.push({id:raw.id,kind:"memory",text:raw.text,envelope:envelope as unknown as SubjectStateWrite["envelope"]});
    const provenance: Json = record(envelope.provenance) ? envelope.provenance : {};
    const rawSources = Array.isArray(provenance.sources) ? provenance.sources : [];
    const ids = rawSources.filter((x:unknown): x is Json => record(x))
      .filter((x:Json) => x.kind === "message" && uuid(x.id))
      .map((x:Json) => String(x.id));
    sources.set(raw.id, ids);
  }
  const eligible = snapshotMemories(all);
  const memories = eligible.map(x=>({id:x.stateId,text:x.text,sourceMessageIds:sources.get(x.stateId) ?? []}));
  const messages = new Map<string,Json>();
  const conversationData: Json = record(document.data.conversations) ? document.data.conversations : {};
  const allMessages = Array.isArray(conversationData.messages) ? conversationData.messages : [];
  for (const item of allMessages) {
    if (record(item) && uuid(item.id)) messages.set(item.id,item);
  }
  if (!memories.length) throw new Error("No current globally recallable G Memory found.");
  return {memories,messages};
}
function precedingUser(messageId: string, messages: Map<string,Json>): string | null {
  let cursor: string | null = messageId;
  const seen = new Set<string>();
  for (let depth=0; cursor && depth<32 && !seen.has(cursor);depth++) {
    seen.add(cursor);
    const m: Json | undefined = messages.get(cursor);
    if (!m) break;
    // Do not use non-current or incomplete transcripts as automatic proxy labels.
    if (m.is_current_path !== true || m.status !== "completed") return null;
    if (m.role === "user" && str(m.display_text)) {
      const text=m.display_text.trim();
      return text.length >= 10 && text.length <= 650 ? text : null;
    }
    cursor = uuid(m.parent_message_id) ? m.parent_message_id : null;
  }
  return null;
}
function pickCorpus(memories: Memory[], messages: Map<string,Json>, max: number):
  {corpus: Memory[]; probes: Probe[]; sourceLinkedPairs: number} {
  const provenanceCases: Array<{query:string; id:string}> = [];
  for (const m of memories) for (const source of m.sourceMessageIds) {
    const query=precedingUser(source,messages);
    if (query) provenanceCases.push({query,id:m.id});
  }
  const byQuery = new Map<string, Set<string>>();
  for (const item of provenanceCases) {
    if (!byQuery.has(item.query)) byQuery.set(item.query,new Set());
    byQuery.get(item.query)!.add(item.id);
  }
  const sourceQueries = [...byQuery].filter(([,ids])=>ids.size<=4)
    .sort(([a],[b])=>hash(a).localeCompare(hash(b))).slice(0,16);
  const included = new Map<string,Memory>();
  const idMap = new Map(memories.map(m=>[m.id,m] as const));
  for (const [,ids] of sourceQueries) for (const id of ids) {
    const m=idMap.get(id);
    if(m && included.size<max) included.set(id,m);
  }
  // Deterministic spread from the rest of the corpus, to avoid cherry-picking.
  const rest=memories.filter(m=>!included.has(m.id))
    .sort((a,b)=>hash(a.id).localeCompare(hash(b.id)));
  for(const m of rest){if(included.size>=max)break;included.set(m.id,m)}
  const corpus=[...included.values()];
  const corpusIds=new Set(included.keys());
  const probes:Probe[]=[];
  for(const [query,ids] of sourceQueries) {
    const relevantIds=[...ids].filter(id=>corpusIds.has(id));
    if(relevantIds.length)probes.push({tag:`source_${probes.length+1}`,query,relevantIds,type:"source_linked"});
  }
  // Trivial exact-text controls are tracked separately, never presented as accuracy.
  const selfRows=[...corpus].sort((a,b)=>hash(a.id+"self").localeCompare(hash(b.id+"self"))).slice(0,8);
  for (const m of selfRows) probes.push({
    tag:`self_${probes.length+1}`,query:m.text.slice(0,160),relevantIds:[m.id],type:"self_quote"
  });
  // Generic unrelated-looking prompts are NOT guaranteed negatives for this user's Mind.
  const generic=[
    "太阳系里有哪些行星","为什么蛋糕烤箱需要预热",
    "能解释一下TCP三次握手吗","我们刚才聊的是什么",
    "怎样计算导数","今天有哪些国际新闻","怎么查询火车时刻表",
    "帮我翻译一段英文",
  ];
  generic.forEach((query,i)=>probes.push({tag:`generic_${i+1}`,query,relevantIds:[],type:"generic_unlabelled"}));
  return {corpus,probes,sourceLinkedPairs:byQuery.size};
}
async function scoreE5(scorer:LocalE5BreathSemanticScorer,query:string,candidates:BreathSemanticCandidate[]):Promise<Score[]> {
  const scored:Score[]=[];
  for(let i=0;i<candidates.length;i+=64) {
    const group=candidates.slice(i,i+64);
    const part=await scorer.score({query,candidates:group});
    for(const c of group) {
      const value=part.get(c.stateId);
      if(value===undefined)throw new Error("Incomplete E5 scores.");
      scored.push({id:c.stateId,score:value});
    }
  }
  return scored.sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id));
}
function checkScores(scores:Score[],floor:number,probe:Probe):Outcome {
  const selected=scores.filter(x=>x.score>=floor).slice(0,4).map(x=>x.id);
  const relevant=new Set(probe.relevantIds);
  return {
    top1:selected[0] && relevant.has(selected[0])?1:0,
    at4:selected.some(id=>relevant.has(id))?1:0,
    total:probe.type==="generic_unlabelled"?0:1,
    returned:selected.length,
    duration:0,kind:probe.type,
  };
}
function summary(results:Outcome[]):Json {
  const groups:Json={};
  for(const kind of ["source_linked","self_quote","generic_unlabelled"] as const) {
    const rows=results.filter(x=>x.kind===kind),labeled=kind!=="generic_unlabelled";
    groups[kind]={
      count:rows.length,
      ...(labeled?{
        weak_top1_hit_rate:rows.length?Number((rows.reduce((n,r)=>n+r.top1,0)/rows.length).toFixed(3)):null,
        weak_hit_at4_rate:rows.length?Number((rows.reduce((n,r)=>n+r.at4,0)/rows.length).toFixed(3)):null,
      }:{generic_empty_fraction:rows.length?Number((rows.filter(r=>r.returned===0).length/rows.length).toFixed(3)):null}),
      average_returned:rows.length?Number((rows.reduce((n,r)=>n+r.returned,0)/rows.length).toFixed(2)):null,
      query_p50_ms:pctl(rows.map(x=>x.duration),.5),
      query_p95_ms:pctl(rows.map(x=>x.duration),.95),
    };
  }
  return groups;
}

const args=process.argv.slice(2);
if(args.length<1 || args.length>2)throw new Error("Run with local Full Backup JSON path, optionally --limit=96.");
const limitArg=args.find(x=>x.startsWith("--limit="));
const path=args.find(x=>!x.startsWith("--"));
if(!path)throw new Error("Local backup path missing.");
const max=limitArg?Number(limitArg.slice(8)):96;
if(!Number.isInteger(max)||max<20||max>256)throw new Error("--limit must be 20..256");
const parsed:unknown=JSON.parse(await readFile(path,"utf8"));
const {memories,messages}=readMemories(parsed);
const {corpus,probes,sourceLinkedPairs}=pickCorpus(memories,messages,max);
const candidates:BreathSemanticCandidate[]=corpus.map(x=>({stateId:x.id,kind:"memory",text:x.text}));
const e5=new LocalE5BreathSemanticScorer();
const ritrieve=new LocalRitrieveBreathSemanticScorer();
try {
  const initStarted=performance.now();
  await ritrieve.warmup();
  const ritrieveWarmupMs=Math.round(performance.now()-initStarted);
  const indexStarted=performance.now();
  await ritrieve.replaceSnapshot({
    version:hash(JSON.stringify(corpus.map(x=>[x.id,x.text]))),
    memories:corpus.map(x=>({stateId:x.id,text:x.text})),
  });
  const ritrieveIndexMs=Math.round(performance.now()-indexStarted);
  // Warm the E5 provider and pre-encode the identical comparison corpus.
  // Exclude cold model/index cost from BOTH models' per-query measurements.
  const e5PrepareStarted=performance.now();
  await scoreE5(e5,"语义模型准备完成",candidates);
  const e5PrepareMs=Math.round(performance.now()-e5PrepareStarted);
  const experiment=new Map<string,Outcome[]>();
  const names=["before_E5_0.80","after_ritrieve_0.68","after_ritrieve_0.76","after_ritrieve_0.78","after_ritrieve_0.80"] as const;
  for(const n of names)experiment.set(n,[]);
  for(const probe of probes) {
    const t0=performance.now();
    const e5Scores=await scoreE5(e5,probe.query,candidates);
    const e5Ms=performance.now()-t0;
    const t1=performance.now();
    const result=await ritrieve.searchSnapshot(probe.query,48);
    const ritMs=performance.now()-t1;
    const sorted=result.hits.map(x=>({id:x.stateId,score:x.score}));
    const values=[
      {key:names[0],scores:e5Scores,floor:.80,ms:e5Ms},
      {key:names[1],scores:sorted,floor:Math.max(.68,result.floor??.68),ms:ritMs},
      {key:names[2],scores:sorted,floor:Math.max(.76,result.floor??.68),ms:ritMs},
      {key:names[3],scores:sorted,floor:Math.max(.78,result.floor??.68),ms:ritMs},
      {key:names[4],scores:sorted,floor:Math.max(.80,result.floor??.68),ms:ritMs},
    ];
    for(const x of values) {
      experiment.get(x.key)!.push({...checkScores(x.scores,x.floor,probe),duration:Math.round(x.ms)});
    }
  }
  const results:Json={};
  for(const [key,rows] of experiment)results[key]=summary(rows);
  console.log(JSON.stringify({
    experiment:"local_real_Mind_before_after_model_comparison",
    memory_total:memories.length,comparison_same_memory_count:corpus.length,
    source_linked_distinct_queries_available:sourceLinkedPairs,
    source_linked_probes_used:probes.filter(x=>x.type==="source_linked").length,
    self_quote_controls:probes.filter(x=>x.type==="self_quote").length,
    unlabelled_generic_probes:probes.filter(x=>x.type==="generic_unlabelled").length,
    before_e5_model_and_corpus_prepare_ms:e5PrepareMs,
    after_ritrieve_warmup_ms:ritrieveWarmupMs,after_ritrieve_index_ms:ritrieveIndexMs,
    results,
    caveats:[
      "E5 and ritrieve compare embedding retrieval on identical sampled candidates, not complete old vs new production Hook implementations.",
      "Source-message links are weak proxy labels. Self-quote controls are trivial. Generic probes are NOT confirmed negative labels.",
      "No personal Memory, chat excerpts, file paths, source IDs or tokens are printed, saved, or transmitted.",
      "This script compares warm query latency after both models have encoded the same corpus; E5 full cold setup and ritrieve full-index costs are separate.",
      "The complete ritrieve 30k-index, background refresh and actual hook+Railway timings are not measured by this script.",
    ],
  },null,2));
}catch(error){
  const name=error instanceof Error&&/^[a-zA-Z0-9_.-]{1,80}$/.test(error.name)?error.name:"UNKNOWN";
  console.error("Local model comparison failed: "+name);
  process.exitCode=1;
}finally {await ritrieve.close()}
