/**
 * Blind LOCAL review of real historical questions against the same eligible
 * current LeileiOS Mind Memory corpus, using pre-change E5 vs new ritrieve.
 *
 * pnpm exec tsx scripts/mind-real-blind-review.ts "/local/path/full-backup.json" --count=12
 *
 * Nothing is written; the terminal displays private texts ONLY locally while
 * the final report includes aggregate counts, not memory texts/IDs/prompts.
 * No LeileiOS DB, auth token, Railway, or remote inference calls.
 * E5 may download PUBLIC model weights if missing from the local cache.
 *
 * This compares embedding ranking/filtering, NOT end-to-end old/new hooks.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { performance } from "node:perf_hooks";
import { stdin, stdout } from "node:process";
import { snapshotMemories } from "../src/domains/runtime/mind/mind-snapshot-version.js";
import { LocalE5BreathSemanticScorer } from "../src/domains/runtime/breath/local-e5-embedding.js";
import { LocalRitrieveBreathSemanticScorer } from "../src/domains/runtime/breath/local-ritrieve-embedding.js";
import type { BreathSemanticCandidate } from "../src/domains/runtime/breath/breath-semantic-recall.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state/subject-state-contract.js";

type Json = Record<string, unknown>;
type Memory = { id: string; text: string };
type Probe = { query: string; group: "lexical_overlap" | "diverse" };
type Hit = { id: string; score: number };
type Review = { relevant: Set<string>; selections: Map<string, string[]>; group: Probe["group"] };
const object = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === "string";
const uuid = (v: unknown): v is string => string(v) && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const digest = (v: string): string => createHash("sha256").update(v).digest("hex");
function loadData(doc: unknown): { memories: Memory[]; prompts: string[] } {
  if (!object(doc) || doc.schema_version !== 4 || !object(doc.data)
      || !Array.isArray(doc.data.mind)) {
    throw new Error("A LeileiOS Full Backup v4 JSON is required.");
  }
  const states: SubjectStateWrite[] = [];
  for(const v of doc.data.mind as unknown[]) {
    if(!object(v) || v.kind !== "memory" || v.subject_id !== "G"
       || !uuid(v.id) || !string(v.text) || !object(v.envelope)
       || !object(v.envelope.scope) || !object(v.envelope.status)) continue;
    states.push({
      id:v.id, kind:"memory", text:v.text,
      envelope:v.envelope as unknown as SubjectStateWrite["envelope"],
    });
  }
  const memories = snapshotMemories(states).map(x => ({id:x.stateId,text:x.text}));
  const conversations: Json = object(doc.data.conversations) ? doc.data.conversations : {};
  const messages: unknown[] = Array.isArray(conversations.messages) ? conversations.messages : [];
  const prompts = [...new Set(messages.flatMap(x => {
    if(!object(x) || x.role !== "user" || x.status !== "completed" ||
       x.is_current_path !== true || !string(x.display_text)) return [];
    const query=x.display_text.trim();
    return query.length>=12 && query.length<=350 ? [query] : [];
  }))];
  return {memories,prompts};
}
function charBigrams(text: string): Set<string> {
  const normalized=text.replace(/\s+/gu,"").toLowerCase();
  const result=new Set<string>();
  for(let i=0;i<normalized.length-1;i++) {
    const pair=normalized.slice(i,i+2);
    if(/[\p{Script=Han}a-z0-9]/iu.test(pair)) result.add(pair);
  }
  return result;
}
function selectProbes(all: string[], memories: Memory[], count: number): Probe[] {
  const memBigrams=memories.map(m=>charBigrams(m.text));
  const scores=all.map(query=>{
    const pieces=charBigrams(query);
    let maxShared=0;
    for(const candidate of memBigrams){
      let shared=0;
      for(const piece of pieces) if(candidate.has(piece)) shared++;
      if(shared>maxShared)maxShared=shared;
    }
    return {query,maxShared};
  });
  const lexical=scores.filter(x=>x.maxShared>=4)
    .sort((a,b)=>b.maxShared-a.maxShared || digest(a.query).localeCompare(digest(b.query)))
    .slice(0,Math.ceil(count/2));
  const taken=new Set(lexical.map(x=>x.query));
  const diverse=scores.filter(x=>!taken.has(x.query))
    .sort((a,b)=>digest(a.query).localeCompare(digest(b.query)))
    .slice(0,count-lexical.length);
  return [...lexical.map(x=>({query:x.query,group:"lexical_overlap" as const})),
          ...diverse.map(x=>({query:x.query,group:"diverse" as const}))];
}
async function e5Scores(scorer:LocalE5BreathSemanticScorer,query:string,candidates:BreathSemanticCandidate[]):Promise<Hit[]> {
  const hits: Hit[]=[];
  for(let i=0;i<candidates.length;i+=64) {
    const group=candidates.slice(i,i+64);
    const part=await scorer.score({query,candidates:group});
    for(const c of group) {
      const score=part.get(c.stateId);
      if(score===undefined)throw new Error("E5 returned incomplete scores.");
      hits.push({id:c.stateId,score});
    }
  }
  hits.sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id));
  return hits;
}
function pick(hits:Hit[], floor:number):string[] {
  return hits.filter(x=>x.score>=floor).slice(0,4).map(x=>x.id);
}
function summarize(reviews:Review[]):Json {
  const names=[
    "before_E5_embedding_0.80",
    "after_ritrieve_0.68",
    "after_ritrieve_0.76",
    "after_ritrieve_0.78",
    "after_ritrieve_0.80",
  ];
  const report:Json={};
  for(const name of names){
    let selectedTotal=0, correct=0, wrong=0, positiveQueries=0;
    let positiveAnyHit=0, totalRelevantPool=0, relevantPoolFound=0;
    let negativeQueries=0, negativeEmpty=0, top1Hit=0;
    for(const review of reviews){
      const chosen=review.selections.get(name)??[];
      selectedTotal+=chosen.length;
      const relevant=review.relevant;
      const hits=chosen.filter(id=>relevant.has(id)).length;
      correct+=hits; wrong+=chosen.length-hits;
      if(relevant.size>0){
        positiveQueries++;
        if(hits>0)positiveAnyHit++;
        if(chosen[0] && relevant.has(chosen[0]))top1Hit++;
        totalRelevantPool+=relevant.size;
        relevantPoolFound+=hits;
      }else{
        negativeQueries++;
        if(chosen.length===0)negativeEmpty++;
      }
    }
    report[name]={
      queries_reviewed:reviews.length,
      user_labeled_relevant_queries:positiveQueries,
      user_labeled_no_relevant_in_union:negativeQueries,
      relevant_query_top1_hit_rate:positiveQueries?Number((top1Hit/positiveQueries).toFixed(3)):null,
      relevant_query_hit_at4:positiveQueries?Number((positiveAnyHit/positiveQueries).toFixed(3)):null,
      recall_among_union_labeled_relevant:totalRelevantPool?Number((relevantPoolFound/totalRelevantPool).toFixed(3)):null,
      unrelated_injections:wrong,
      incorrect_injection_fraction:selectedTotal?Number((wrong/selectedTotal).toFixed(3)):0,
      negative_query_empty_rate:negativeQueries?Number((negativeEmpty/negativeQueries).toFixed(3)):null,
      mean_memories_selected:Number((selectedTotal/Math.max(1,reviews.length)).toFixed(2)),
    };
  }
  return report;
}
const argv=process.argv.slice(2);
const path=argv.find(x=>!x.startsWith("--"));
const countString=argv.find(x=>x.startsWith("--count="));
const limitString=argv.find(x=>x.startsWith("--limit="));
const count=countString?Number(countString.slice(8)):8;
const limit=limitString?Number(limitString.slice(8)):256;
if(!path || !Number.isInteger(count) || count<4 || count>24
    || !Number.isInteger(limit) || limit<20 || limit>256) {
  throw new Error('Usage: tsx scripts/mind-real-blind-review.ts "/local/full-backup.json" [--count=4..24] [--limit=20..256]');
}
const json:unknown=JSON.parse(await readFile(path,"utf8"));
const loaded=loadData(json);
if(loaded.memories.length===0)throw new Error("No eligible global Memory in this backup.");
if(loaded.prompts.length===0)throw new Error("No eligible historical user queries in this backup.");
const corpus=loaded.memories.sort((a,b)=>digest(a.id).localeCompare(digest(b.id))).slice(0,limit);
const probes=selectProbes(loaded.prompts,corpus,count);
const candidates:BreathSemanticCandidate[]=corpus.map(m=>({stateId:m.id,text:m.text,kind:"memory"}));
const byId=new Map(corpus.map(m=>[m.id,m] as const));
const e5=new LocalE5BreathSemanticScorer();
const ritrieve=new LocalRitrieveBreathSemanticScorer();
const reviews:Review[]=[];
const rl=createInterface({input:stdin,output:stdout});
try {
  console.log(`本地盲测：${corpus.length} 条当前有效 Memory，${loaded.prompts.length} 条可选历史提问，计划 ${probes.length} 轮。`);
  console.log("屏幕会显示私人提问与记忆，仅留在本机终端。输入编号表示相关记忆，0=全都无关，s=跳过。");
  console.log("最后只复制 AGGREGATE_RESULT_JSON 标记后的统计 JSON，不要复制上方私人正文。");
  await ritrieve.warmup();
  await ritrieve.replaceSnapshot({
    version:digest(JSON.stringify(corpus.map(m=>[m.id,m.text]))),
    memories:corpus.map(m=>({stateId:m.id,text:m.text})),
  });
  await e5Scores(e5,"语义模型准备完成",candidates); // warm the old model/corpus
  const names=[
    "before_E5_embedding_0.80",
    "after_ritrieve_0.68",
    "after_ritrieve_0.76",
    "after_ritrieve_0.78",
    "after_ritrieve_0.80",
  ];
  for(let i=0;i<probes.length;i++){
    const probe=probes[i]!;
    const old=await e5Scores(e5,probe.query,candidates);
    const r=await ritrieve.searchSnapshot(probe.query,48);
    const next:Hit[]=r.hits.map(x=>({id:x.stateId,score:x.score}));
    const selections=new Map<string,string[]>([
      [names[0]!,pick(old,.8)],
      [names[1]!,pick(next,Math.max(.68,r.floor??.68))],
      [names[2]!,pick(next,Math.max(.76,r.floor??.68))],
      [names[3]!,pick(next,Math.max(.78,r.floor??.68))],
      [names[4]!,pick(next,Math.max(.80,r.floor??.68))],
    ]);
    const union=new Set<string>();
    for(const values of selections.values())for(const id of values)union.add(id);
    const displayed=[...union].sort((a,b)=>digest(probe.query+a).localeCompare(digest(probe.query+b)));
    console.log(`\n========== ${i+1}/${probes.length} · ${probe.group} ==========\n历史问题：${probe.query}`);
    if(!displayed.length)console.log("两种模型都没有选出记忆，无法形成有标签的候选池；跳过本题。");
    for(let j=0;j<displayed.length;j++){
      const memory=byId.get(displayed[j]!);
      if(!memory)throw new Error("Blind review index mismatch.");
      const visible=memory.text.length>450?memory.text.slice(0,450)+"……":memory.text;
      console.log(`\n[${j+1}] ${visible}`);
    }
    if(displayed.length===0)continue;
    let relevant=new Set<string>();
    let skipped=false;
    if(displayed.length>0) {
      while(true){
        const answer=(await rl.question("\n确实相关的记忆编号（如 1,3；全无关输入 0；跳过输入 s）：")).trim();
        if(answer.toLowerCase()==="s"){skipped=true;break}
        if(answer==="0"){relevant=new Set();break}
        const pieces=answer.split(/[,，\s]+/u).filter(Boolean);
        const numbers=pieces.map(x=>Number(x));
        if(numbers.length && numbers.every(n=>Number.isInteger(n)&&n>=1&&n<=displayed.length)){
          relevant=new Set(numbers.map(n=>displayed[n-1]!));
          break;
        }
        console.log("输入无效，请只填写屏幕上出现的编号。");
      }
    }
    if(!skipped)reviews.push({relevant,selections,group:probe.group});
  }
  console.log("\nAGGREGATE_RESULT_JSON_START");
  console.log(JSON.stringify({
    experiment:"real_Mind_blind_human_review_of_embedding_retrieval",
    input_eligible_total:loaded.memories.length,
    sampled_corpus_count:corpus.length,
    available_user_queries:loaded.prompts.length,
    proposed_query_count:probes.length,
    reviewed_query_count:reviews.length,
    skipped_or_unjudgeable_queries:probes.length-reviews.length,
    summary:summarize(reviews),
    limitations:[
      "Unreviewed questions (human skipped or neither model offered a candidate) are excluded, not counted as true negatives.",
      "Queries are real historical user messages; user grades relevance of the UNION of methods' proposed memories.",
      "No candidate outside the shown union is manually judged; recall is conditional on this candidate pool.",
      "This compares old E5 embedding and new ritrieve embedding retrieval, not full old/new production Hook behavior.",
      "All private data remain on the Mac; only anonymous aggregate statistics should be shared.",
    ],
  },null,2));
} catch(error){
  const name=error instanceof Error && /^[A-Za-z0-9_.-]{1,64}$/.test(error.name) ? error.name : "UNKNOWN";
  console.error(`Blind review failed: ${name}`);
  process.exitCode=1;
}finally{
  rl.close();
  await ritrieve.close();
}
