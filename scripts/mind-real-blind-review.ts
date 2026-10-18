/**
 * Blind LOCAL review of real historical questions against the same eligible
 * current LeileiOS Mind Memory corpus, using pre-change E5 vs new ritrieve.
 *
 * pnpm exec tsx scripts/mind-real-blind-review.ts "/local/path/full-backup.json" --count=12
 *
 * With --review-file ABSOLUTE_PATH, queries and private judgements are saved
 * only in a mode-0600 on-device JSON outside the repository for repeat A/B.
 * Without --review-file, no input/labels are saved. Aggregates hide all text.
 * No LeileiOS DB, auth token, Railway, or remote inference calls.
 * E5 may download PUBLIC model weights if missing from the local cache.
 *
 * This compares embedding ranking/filtering, NOT end-to-end old/new hooks.
 */
import { createHash, randomUUID } from "node:crypto";
import { open, readFile, lstat, realpath, mkdir, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { performance } from "node:perf_hooks";
import { stdin, stdout } from "node:process";
import { snapshotMemories } from "../src/domains/runtime/mind/mind-snapshot-version.js";
import { LocalE5BreathSemanticScorer } from "../src/domains/runtime/breath/local-e5-embedding.js";
import { LocalRitrieveBreathSemanticScorer } from "../src/domains/runtime/breath/local-ritrieve-embedding.js";
import { selectHybridMindCandidates, selectHybridMindCandidatesConditional } from "../src/domains/runtime/mind/mind-hybrid-candidates.js";
import type { BreathSemanticCandidate } from "../src/domains/runtime/breath/breath-semantic-recall.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state/subject-state-contract.js";

type Json = Record<string, unknown>;
type Memory = { id: string; text: string };
type Probe = { query: string; group: "lexical_overlap" | "diverse" | "manual_entered" };
type Hit = { id: string; score: number };
type Review = { relevant: Set<string>; selections: Map<string, string[]>; group: Probe["group"] };
type SavedCase = Probe & {judged_ids: string[]; relevant_ids: string[]; labeled: boolean};
type SavedReview = {schema_version: 1; corpus_fingerprint: string; cases: SavedCase[]};
const object = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === "string";
const uuid = (v: unknown): v is string => string(v) && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const digest = (v: string): string => createHash("sha256").update(v).digest("hex");
function loadData(doc: unknown): { memories: Memory[]; prompts: string[]; exportedMessageCount: number; completedUserMessageCount: number } {
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
  const completedUserMessages = messages.filter(x => object(x)
    && x.role === "user" && x.status === "completed" && string(x.display_text));
  const eligibleMessage = (x: unknown): x is Json => object(x)
    && x.role === "user" && x.status === "completed" && string(x.display_text)
    && x.display_text.trim().length >= 12 && x.display_text.trim().length <= 350;
  const currentPath = completedUserMessages.filter(x => object(x) && x.is_current_path === true);
  // Prefer active-branch history, but old branches are fine as *test queries*:
  // this offline read never injects their content into a live Hook.
  const sourceMessages = currentPath.some(eligibleMessage)
    ? currentPath : completedUserMessages;
  const prompts = [...new Set(sourceMessages
    .filter(eligibleMessage).map(x => (x.display_text as string).trim()))];
  return {memories,prompts,exportedMessageCount:messages.length,
    completedUserMessageCount:completedUserMessages.length};
}
/**
 * Private on-device human labels. The fingerprint binds to IDs and current text;
 * never reuses labels after any Memory change or corpus sampling change.
 */
function parseSavedReview(value: unknown, fingerprint: string, knownIds: Set<string>): SavedReview {
  if (!object(value) || value.schema_version !== 1 || value.corpus_fingerprint !== fingerprint
      || !Array.isArray(value.cases) || value.cases.length > 24) {
    throw new Error("Private label set does not match the current Memory snapshot. Use a new review-file path.");
  }
  const seen = new Set<string>();
  const cases: SavedCase[] = [];
  for (const item of value.cases as unknown[]) {
    if (!object(item) || !string(item.query) || item.query.length < 4 || item.query.length > 350
        || !["lexical_overlap","diverse","manual_entered"].includes(String(item.group))
        || !Array.isArray(item.judged_ids) || !Array.isArray(item.relevant_ids)
        || typeof item.labeled !== "boolean"
        || !item.judged_ids.every((id:unknown)=>string(id)&&knownIds.has(id))
        || !item.relevant_ids.every((id:unknown)=>string(id)&&knownIds.has(id))
        || seen.has(item.query) || (item.labeled === false && (item.judged_ids.length > 0 || item.relevant_ids.length > 0))) {
      throw new Error("Private label file contains invalid data.");
    }
    const judgedIds=item.judged_ids as string[];
    const relevantIds=item.relevant_ids as string[];
    if (new Set(judgedIds).size !== judgedIds.length
        || new Set(relevantIds).size !== relevantIds.length
        || relevantIds.some(id=>!judgedIds.includes(id))) {
      throw new Error("Private labels contain duplicate or unjudged IDs.");
    }
    seen.add(item.query);
    cases.push({query:item.query,group:item.group as Probe["group"],
      judged_ids:judgedIds,relevant_ids:relevantIds,labeled:item.labeled});
  }
  return {schema_version:1,corpus_fingerprint:fingerprint,cases};
}

async function loadPrivateReview(filePath: string, fingerprint: string, knownIds: Set<string>): Promise<SavedReview | null> {
  try {
    const st=await lstat(filePath);
    if (!st.isFile() || (st.mode & 0o077)!==0) throw new Error("Private labels must be a regular mode-0600 file.");
    return parseSavedReview(JSON.parse(await readFile(filePath,"utf8")),fingerprint,knownIds);
  } catch(error) {
    if ((error as NodeJS.ErrnoException).code==="ENOENT") return null;
    throw error;
  }
}

async function savePrivateReview(filePath: string, value: SavedReview): Promise<void> {
  const dir=dirname(filePath);
  await mkdir(dir,{recursive:true,mode:0o700});
  const [folder,checkout]=await Promise.all([realpath(dir),realpath(process.cwd())]);
  if (folder===checkout || folder.startsWith(checkout+sep))
    throw new Error("Keep the private labels OUTSIDE the repository checkout.");
  const dirStat=await lstat(dir);
  if (!dirStat.isDirectory() || (dirStat.mode & 0o077)!==0)
    throw new Error("Private labels require a private (mode 0700) folder.");
  try {
    const existing=await lstat(filePath);
    if (!existing.isFile() || (existing.mode & 0o077)!==0) throw new Error("Unsafe existing private label file.");
  }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}
  const temp=filePath+"."+randomUUID()+".tmp";
  const handle=await open(temp,"wx",0o600);
  try {
    await handle.writeFile(JSON.stringify(value,null,2)+"\n","utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try{await rename(temp,filePath)}catch(error){await unlink(temp).catch(()=>undefined);throw error}
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
    "hybrid_agreement",
    "hybrid_anchored_rescue",
    "hybrid_agreement_top1",
    "hybrid_conditional_second",
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
const forceManual=argv.includes("--manual");
const reviewFileArgument=argv.find(x=>x.startsWith("--review-file="));
const reviewFile=reviewFileArgument?.slice("--review-file=".length);
if (reviewFile!==undefined && (!isAbsolute(reviewFile) || reviewFile===resolve(process.cwd())))
  throw new Error("--review-file needs an absolute file path in a private directory outside this checkout.");
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
// Some valid Full Backups have Mind but zero exported native_live messages.
// Never fabricate historical questions or call an online model to generate them.
const corpus=loaded.memories.sort((a,b)=>digest(a.id).localeCompare(digest(b.id))).slice(0,limit);
const fingerprint=digest(JSON.stringify(corpus.map(m=>[m.id,m.text])));
const stored=reviewFile ? await loadPrivateReview(reviewFile,fingerprint,new Set(corpus.map(m=>m.id))) : null;
let savedReview:SavedReview|null=stored;
const probes:Probe[]=stored?.cases.length ? stored.cases.map(x=>({query:x.query,group:x.group}))
  : forceManual ? [] : selectProbes(loaded.prompts,corpus,count);
const candidates:BreathSemanticCandidate[]=corpus.map(m=>({stateId:m.id,text:m.text,kind:"memory"}));
const byId=new Map(corpus.map(m=>[m.id,m] as const));
const e5=new LocalE5BreathSemanticScorer();
const ritrieve=new LocalRitrieveBreathSemanticScorer();
const reviews:Review[]=[];
const rl=createInterface({input:stdin,output:stdout});
try {
  console.log(`本地盲测：${corpus.length} 条当前有效 Memory，备份消息数 ${loaded.exportedMessageCount}，其中已完成用户消息 ${loaded.completedUserMessageCount}，可用历史提问 ${loaded.prompts.length}。`);
  if(stored?.cases.length) console.log("已读取本机固定题库；完全标注过的候选无需再次作答。");
  if(probes.length===0) {
    console.log("这份备份没有符合条件的历史提问，或启用了 --manual。现在直接在这台 Mac 输入真实测试问题。");
    console.log("建议一半关于实际记忆（可用含糊的说法），一半完全无关或仅主题相似，来衡量漏召回和误召回。");
    console.log("每行一个问题，按回车继续；直接回车可提前结束。问题不会上传、保存或出现在最终 JSON。");
    const dedupe=new Set<string>();
    for(let i=0;i<count;) {
      const query=(await rl.question(`测试问题 ${i+1}/${count}：`)).trim();
      if(!query)break;
      if(query.length<4 || query.length>350) {
        console.log("请把问题控制在 4～350 字之间。");
        continue;
      }
      if(dedupe.has(query)){console.log("这条问题已输入过，请换一个。");continue}
      dedupe.add(query);
      probes.push({query,group:"manual_entered"});
      i++;
    }
    if(probes.length===0) {
      const error=new Error("No questions entered.");
      error.name="NO_TEST_QUERIES";
      throw error;
    }
  }
  if (reviewFile) {
    if (!savedReview) savedReview={schema_version:1,corpus_fingerprint:fingerprint,
      cases:probes.map(p=>({...p,judged_ids:[],relevant_ids:[],labeled:false}))};
    await savePrivateReview(reviewFile,savedReview);
  }
  console.log(`本次共 ${probes.length} 题，下面开始两个模型的本地盲测。`);
  console.log("屏幕会显示私人提问与记忆，仅留在本机终端。输入编号表示相关记忆，0=全都无关，s=跳过。");
  console.log("最后只复制 AGGREGATE_RESULT_JSON 标记后的统计 JSON，不要复制上方私人正文。");
  await ritrieve.warmup();
  await ritrieve.replaceSnapshot({
    version:fingerprint,
    memories:corpus.map(m=>({stateId:m.id,text:m.text})),
  });
  await e5Scores(e5,"语义模型准备完成",candidates); // warm the old model/corpus
  const names=[
    "before_E5_embedding_0.80",
    "after_ritrieve_0.68",
    "after_ritrieve_0.76",
    "after_ritrieve_0.78",
    "after_ritrieve_0.80",
    "hybrid_agreement",
    "hybrid_anchored_rescue",
    "hybrid_agreement_top1",
    "hybrid_conditional_second",
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
      [names[5]!,selectHybridMindCandidates({
        query:probe.query,
        memories:corpus.map(m=>({stateId:m.id,text:m.text})),
        e5Ranked:old.map(x=>({stateId:x.id,score:x.score})),
        ritrieveRanked:next.map(x=>({stateId:x.id,score:x.score})),
        mode:"agreement",
      }).map(x=>x.stateId)],
      [names[6]!,selectHybridMindCandidates({
        query:probe.query,
        memories:corpus.map(m=>({stateId:m.id,text:m.text})),
        e5Ranked:old.map(x=>({stateId:x.id,score:x.score})),
        ritrieveRanked:next.map(x=>({stateId:x.id,score:x.score})),
        mode:"anchored_rescue",
      }).map(x=>x.stateId)],
      [names[7]!,selectHybridMindCandidates({
        query:probe.query,
        memories:corpus.map(m=>({stateId:m.id,text:m.text})),
        e5Ranked:old.map(x=>({stateId:x.id,score:x.score})),
        ritrieveRanked:next.map(x=>({stateId:x.id,score:x.score})),
        mode:"agreement",
        maxItems:1,
      }).map(x=>x.stateId)],
      [names[8]!,selectHybridMindCandidatesConditional({
        query:probe.query,
        memories:corpus.map(m=>({stateId:m.id,text:m.text})),
        e5Ranked:old.map(x=>({stateId:x.id,score:x.score})),
        ritrieveRanked:next.map(x=>({stateId:x.id,score:x.score})),
        mode:"agreement",
      }).map(x=>x.stateId)],
    ]);
    const union=new Set<string>();
    for(const values of selections.values())for(const id of values)union.add(id);
    const displayed=[...union].sort((a,b)=>digest(probe.query+a).localeCompare(digest(probe.query+b)));
    const savedCase=savedReview?.cases.find(x=>x.query===probe.query);
    const judged=new Set(savedCase?.labeled ? savedCase.judged_ids : []);
    const unseen=displayed.filter(id=>!judged.has(id));
    const relevant=new Set<string>(savedCase?.labeled ? savedCase.relevant_ids : []);
    console.log(`\n========== ${i+1}/${probes.length} · ${probe.group} ==========\n测试问题：${probe.query}`);
    if (unseen.length===0 && savedCase?.labeled) {
      console.log("复用本机已保存的相关性判断，无需再次作答。");
      reviews.push({relevant,selections,group:probe.group});
      continue;
    }
    if (unseen.length===0) {
      console.log("所有检索方式均无候选，无法自动断定全库无相关记忆；本题不计入准确率。");
      continue;
    }
    if (savedCase?.labeled) console.log("仅显示本轮新增的候选；原有标注自动保留。");
    for(let j=0;j<unseen.length;j++){
      const memory=byId.get(unseen[j]!);
      if(!memory)throw new Error("Blind review index mismatch.");
      const visible=memory.text.length>450?memory.text.slice(0,450)+"……":memory.text;
      console.log(`\n[${j+1}] ${visible}`);
    }
    let skipped=false;
    while(true){
      const answer=(await rl.question("\n新增候选中确实相关的编号（如 1,3；全部无关输入 0；跳过输入 s）：")).trim();
      if(answer.toLowerCase()==="s"){skipped=true;break}
      if(answer==="0")break;
      const pieces=answer.split(/[,，\s]+/u).filter(Boolean);
      const numbers=pieces.map(x=>Number(x));
      if(numbers.length && numbers.every(n=>Number.isInteger(n)&&n>=1&&n<=unseen.length)){
        for(const id of numbers.map(n=>unseen[n-1]!)) relevant.add(id);
        break;
      }
      console.log("输入无效，请只填写屏幕上出现的编号。");
    }
    if(skipped)continue;
    reviews.push({relevant,selections,group:probe.group});
    if(savedReview && reviewFile) {
      const nextCase:SavedCase={...probe,labeled:true,
        judged_ids:[...new Set([...(savedCase?.judged_ids ?? []),...displayed])],
        relevant_ids:[...relevant]};
      savedReview={...savedReview,cases:savedReview.cases.map(x=>x.query===probe.query?nextCase:x)};
      await savePrivateReview(reviewFile,savedReview);
    }
  }
  console.log("\nAGGREGATE_RESULT_JSON_START");
  console.log(JSON.stringify({
    experiment:"real_Mind_blind_human_review_of_embedding_retrieval",
    input_eligible_total:loaded.memories.length,
    sampled_corpus_count:corpus.length,
    available_user_queries:loaded.prompts.length,
    exported_message_count:loaded.exportedMessageCount,
    completed_user_message_count:loaded.completedUserMessageCount,
    prompt_origin:probes[0]?.group==="manual_entered"?"user_typed_on_device":"historical_export",
    proposed_query_count:probes.length,
    reviewed_query_count:reviews.length,
    skipped_or_unjudgeable_queries:probes.length-reviews.length,
    fixed_local_review_enabled:Boolean(reviewFile),
    reused_private_query_count:stored?.cases.length ?? 0,
    summary:summarize(reviews),
    limitations:[
      "Unreviewed questions (human skipped or neither model offered a candidate) are excluded, not counted as true negatives.",
      "Queries are either exported historical user messages or user-authored locally at test time; user grades the union of proposed memories.",
      "No candidate outside the reviewed union is judged; recall is conditional on the saved candidate pool.",
      "The optional private review-file stays outside the repository with mode 0600; never paste or upload it.",
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
