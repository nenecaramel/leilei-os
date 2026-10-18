/**
 * PRIVATE LOCAL ONLY: compare conservative no-production-change policies on
 * original 8 + 12 human-labeled Mind questions, from a matching v4 backup.
 * No network, Railway, Hook, user-content logging or file writes.
 * Tests only the fixed 20-question historical candidate subset; beware overfit.
 *
 * pnpm exec tsx scripts/mind-hybrid2-private-policy-sweep.ts \
 *   "$BACKUP" "$HOME/.leileios/mind-eval/fixed-review.json" \
 *   "$HOME/.leileios/mind-eval/fixed-review-round2.json"
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { snapshotMemories } from "../src/domains/runtime/mind/mind-snapshot-version.js";
import { LocalE5BreathSemanticScorer } from "../src/domains/runtime/breath/local-e5-embedding.js";
import { LocalRitrieveBreathSemanticScorer } from "../src/domains/runtime/breath/local-ritrieve-embedding.js";
import { selectHybridMindCandidatesConditional } from "../src/domains/runtime/mind/mind-hybrid-candidates.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state/subject-state-contract.js";

type RecordLike = Record<string, unknown>;
type Memory = {stateId:string; text:string};
type Review = {query:string; judged_ids:string[]; relevant_ids:string[]; labeled:true};
type Policy = {name:string; limit:1|2; e5Min:number; ritMin:number;
  secondOnly?:boolean; maxE5Gap?:number; maxRitGap?:number};
type Counts = {
  questions:number; positiveQuestions:number; positiveQueryHits:number;
  negativeQuestions:number; negativeEmpty:number; correct:number; wrong:number;
  unjudged:number; returned:number; relevantTotal:number; relevantFound:number;
};
const object=(v:unknown):v is RecordLike=>typeof v==="object"&&v!==null&&!Array.isArray(v);
const str=(v:unknown):v is string=>typeof v==="string";
const uuid=(v:unknown):v is string=>str(v)&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const policies:readonly Policy[]=[
  {name:"CURRENT_CONDITIONAL_TWO",limit:2,e5Min:0,ritMin:0},
  {name:"CURRENT_TOP_ONE_ONLY",limit:1,e5Min:0,ritMin:0},
  {name:"TWO_MIN_E5_085_RIT_072",limit:2,e5Min:.85,ritMin:.72},
  {name:"TWO_MIN_E5_088_RIT_076",limit:2,e5Min:.88,ritMin:.76},
  {name:"TWO_MIN_E5_090_RIT_080",limit:2,e5Min:.90,ritMin:.80},
  {name:"ONE_MIN_E5_085_RIT_072",limit:1,e5Min:.85,ritMin:.72},
  {name:"ONE_MIN_E5_088_RIT_076",limit:1,e5Min:.88,ritMin:.76},
  // Exploratory gates applied ONLY to the optional second memory.
  // These keep top-one behavior unchanged instead of suppressing first hits.
  {name:"SECOND_ONLY_MIN_E5_086_RIT_072",limit:2,e5Min:.86,ritMin:.72,secondOnly:true},
  {name:"SECOND_ONLY_MIN_E5_088_RIT_076",limit:2,e5Min:.88,ritMin:.76,secondOnly:true},
  {name:"SECOND_ONLY_MIN_E5_090_RIT_080",limit:2,e5Min:.90,ritMin:.80,secondOnly:true},
  {name:"SECOND_ONLY_GAP_E5_020_RIT_030",limit:2,e5Min:0,ritMin:0,
    secondOnly:true,maxE5Gap:.020,maxRitGap:.030},
  {name:"SECOND_ONLY_GAP_E5_015_RIT_020",limit:2,e5Min:0,ritMin:0,
    secondOnly:true,maxE5Gap:.015,maxRitGap:.020},
];
const counts=():Counts=>({
  questions:0,positiveQuestions:0,positiveQueryHits:0,
  negativeQuestions:0,negativeEmpty:0,correct:0,wrong:0,
  unjudged:0,returned:0,relevantTotal:0,relevantFound:0,
});
const sorted=(map:ReadonlyMap<string,number>,candidates:readonly Memory[])=>candidates
  .map(c=>({stateId:c.stateId,score:map.get(c.stateId)}))
  .map(row=>{
    if(row.score===undefined||!Number.isFinite(row.score)||row.score<0||row.score>1)
      throw new Error("INCOMPLETE_MODEL_SCORES");
    return {stateId:row.stateId,score:row.score};
  }).sort((a,b)=>b.score-a.score||a.stateId.localeCompare(b.stateId));
const pct=(values:number[],percent:number)=>{
  const v=[...values].sort((a,b)=>a-b);
  return Math.round((v[Math.max(0,Math.ceil(v.length*percent)-1)]??0)*10)/10;
};
function loadCorpus(value:unknown):Memory[]{
  if(!object(value)||value.schema_version!==4||!object(value.data)
      ||!Array.isArray(value.data.mind))throw new Error("INVALID_BACKUP");
  const states:SubjectStateWrite[]=[];
  for(const row of value.data.mind){
    if(!object(row)||row.kind!=="memory"||row.subject_id!=="G"||!uuid(row.id)
       ||!str(row.text)||!object(row.envelope)
       ||!object(row.envelope.scope)||!object(row.envelope.status))continue;
    states.push({id:row.id,kind:"memory",text:row.text,
      envelope:row.envelope as unknown as SubjectStateWrite["envelope"]});
  }
  const corpus=snapshotMemories(states)
    .map(c=>({stateId:c.stateId,text:c.text}))
    .sort((a,b)=>sha(a.stateId).localeCompare(sha(b.stateId)));
  if(!corpus.length)throw new Error("NO_ELIGIBLE_MEMORIES");
  return corpus;
}
function validatedReview(value:unknown,fingerprint:string,known:Set<string>):Review[]{
  if(!object(value)||value.schema_version!==1||value.corpus_fingerprint!==fingerprint
      ||!Array.isArray(value.cases))throw new Error("PRIVATE_REVIEW_MISMATCH");
  return value.cases.map((item:unknown)=>{
    if(!object(item)||!str(item.query)||!item.query.trim()
        ||item.labeled!==true||!Array.isArray(item.judged_ids)
        ||!Array.isArray(item.relevant_ids))throw new Error("INVALID_PRIVATE_LABEL");
    const judged:unknown[]=item.judged_ids;
    const relevant:unknown[]=item.relevant_ids;
    if(!judged.every(id=>str(id)&&known.has(id))
        ||!relevant.every(id=>str(id)&&judged.includes(id))
        ||new Set(judged).size!==judged.length||new Set(relevant).size!==relevant.length)
      throw new Error("INVALID_PRIVATE_LABEL");
    return {query:item.query,judged_ids:judged as string[],
      relevant_ids:relevant as string[],labeled:true as const};
  });
}
function observe(bucket:Counts,r:Review,ids:string[]){
  const judged=new Set(r.judged_ids);
  const relevant=new Set(r.relevant_ids);
  const correct=ids.filter(id=>relevant.has(id)).length;
  bucket.questions++;
  bucket.correct+=correct;
  bucket.wrong+=ids.filter(id=>judged.has(id)&&!relevant.has(id)).length;
  bucket.unjudged+=ids.filter(id=>!judged.has(id)).length;
  bucket.returned+=ids.length;
  bucket.relevantTotal+=relevant.size;
  bucket.relevantFound+=correct;
  if(relevant.size){
    bucket.positiveQuestions++;
    if(correct>0)bucket.positiveQueryHits++;
  }else{
    bucket.negativeQuestions++;
    if(ids.length===0)bucket.negativeEmpty++;
  }
}
function display(bucket:Counts){
  return {...bucket,
    judged_precision:bucket.correct+bucket.wrong>0
      ?Math.round(1000*bucket.correct/(bucket.correct+bucket.wrong))/1000:null,
    positive_hit_rate:bucket.positiveQuestions
      ?Math.round(1000*bucket.positiveQueryHits/bucket.positiveQuestions)/1000:null,
    negative_empty_rate:bucket.negativeQuestions
      ?Math.round(1000*bucket.negativeEmpty/bucket.negativeQuestions)/1000:null,
  };
}
async function main(){
  const [backup,...reviewPaths]=process.argv.slice(2);
  if(!backup||reviewPaths.length!==2||reviewPaths.some(p=>!p))
    throw new Error("EXPECTED_BACKUP_AND_TWO_REVIEWS");
  const all=loadCorpus(JSON.parse(await readFile(backup,"utf8")));
  const raw:unknown[]=[];
  for(const path of reviewPaths)raw.push(JSON.parse(await readFile(path,"utf8")));
  const fingerprints=raw.map(v=>object(v)&&str(v.corpus_fingerprint)?v.corpus_fingerprint:"");
  if(!fingerprints[0]||fingerprints[0]!==fingerprints[1])
    throw new Error("PRIVATE_REVIEW_FINGERPRINT_MISMATCH");
  const fingerprint=fingerprints[0]!;
  const originalSize=Array.from({length:Math.min(256,all.length)},(_,i)=>i+1)
    .find(n=>sha(JSON.stringify(all.slice(0,n).map(m=>[m.stateId,m.text])))===fingerprint);
  if(!originalSize)throw new Error("PRIVATE_REVIEW_CORPUS_MISMATCH");
  const memory=all.slice(0,originalSize);
  const known=new Set(memory.map(c=>c.stateId));
  const groups=raw.map(r=>validatedReview(r,fingerprint,known));
  if(groups[0]?.length!==8||groups[1]?.length!==12
      ||new Set(groups.flat().map(c=>c.query)).size!==20)
    throw new Error("EXPECTED_UNIQUE_FIXED_8_PLUS_12");
  const inputCandidates=memory.map(m=>({...m,kind:"memory" as const}));
  const e5=new LocalE5BreathSemanticScorer();
  const rit=new LocalRitrieveBreathSemanticScorer({passageCacheEntries:4096});
  const summaries=Object.fromEntries(policies.map(p=>[p.name,{
    total:counts(),fixed_8:counts(),fixed_12:counts(),
  }])) as Record<string,{total:Counts;fixed_8:Counts;fixed_12:Counts}>;
  const latency:number[]=[];
  try{
    const start=performance.now();
    await Promise.all([
      e5.score({query:"本地模型就绪",candidates:[{stateId:"warm",kind:"memory",text:"公开模型就绪"}]}),
      rit.warmup(),
    ]);
    const warmup=performance.now()-start;
    for(let g=0;g<groups.length;g++){
      for(const review of groups[g]!){
        const begin=performance.now();
        const [left,right]=await Promise.all([
          e5.score({query:review.query,candidates:inputCandidates}),
          rit.score({query:review.query,candidates:inputCandidates}),
        ]);
        latency.push(performance.now()-begin);
        const e5Ranked=sorted(left,memory);
        const ritRanked=sorted(right,memory);
        const chosen=selectHybridMindCandidatesConditional({
          query:review.query,mode:"agreement",memories:memory,
          e5Ranked,ritrieveRanked:ritRanked,
        }).map(x=>x.stateId);
        if(chosen.length>2||chosen.some(id=>!known.has(id)))
          throw new Error("INVALID_SELECTION");
        for(const policy of policies){
          const first=chosen[0];
          const ids=chosen.filter((id,index)=>{
            // A second-only gate must not modify which first memory is kept.
            if(policy.secondOnly&&index===0)return true;
            const e5Score=left.get(id)??-1;
            const ritScore=right.get(id)??-1;
            if(e5Score<policy.e5Min||ritScore<policy.ritMin)return false;
            if(policy.secondOnly&&index===1&&first){
              if(policy.maxE5Gap!==undefined
                  &&(left.get(first)??-1)-e5Score>policy.maxE5Gap)return false;
              if(policy.maxRitGap!==undefined
                  &&(right.get(first)??-1)-ritScore>policy.maxRitGap)return false;
            }
            return true;
          }).slice(0,policy.limit);
          const row=summaries[policy.name]!;
          observe(row.total,review,ids);
          observe(g===0?row.fixed_8:row.fixed_12,review,ids);
        }
      }
    }
    console.log(JSON.stringify({
      stage:"PRIVATE_FIXED_REVIEW_POLICY_SWEEP_COMPLETE",
      eligible_memory_total:all.length,reviewed_corpus_count:memory.length,
      questions:20,model:"E5_plus_ritrieve",
      model_warmup_ms:Math.round(warmup),
      model_scoring_p50_ms:pct(latency,.5),
      model_scoring_p95_ms:pct(latency,.95),
      model_scoring_max_ms:pct(latency,1),
      policies:Object.fromEntries(policies.map(policy=>[policy.name,{
        overall:display(summaries[policy.name]!.total),
        fixed_8:display(summaries[policy.name]!.fixed_8),
        fixed_12:display(summaries[policy.name]!.fixed_12),
      }])),
      limitations:[
        "Exploratory in-sample comparison only: the SAME 20 labeled questions are being used for tuning; gains can be overfitting, not independent validation.",
        "Candidates are the matching historic 20..256-memory subset, not the complete Railway SQL recall stage.",
        "Zero relevant IDs means none in previously judged candidate union, not necessarily none in all Memory.",
        "Unjudged selections are reported separately; only judged nonrelevant counts as wrong.",
        "No user questions, Memory text, IDs or credentials printed, saved or transmitted.",
        "No runtime thresholds or production behavior were changed.",
      ],
    },null,2));
  }finally{
    await rit.close().catch(()=>undefined);
  }
}
try{await main()}
catch(e){
  const code=e instanceof Error&&/^[A-Z_]{3,90}$/.test(e.message)
    ?e.message:"PRIVATE_POLICY_SWEEP_FAILED";
  console.error(code);process.exitCode=1;
}
