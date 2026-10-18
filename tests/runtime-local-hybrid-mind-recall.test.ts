import assert from "node:assert/strict";
import test from "node:test";
import { LocalHybridMindRecallScorer } from "../src/domains/runtime/mind/local-hybrid-mind-recall.js";
import type { LocalE5BreathSemanticScorer } from "../src/domains/runtime/breath/local-e5-embedding.js";
import type { LocalRitrieveBreathSemanticScorer } from "../src/domains/runtime/breath/local-ritrieve-embedding.js";

const version="a".repeat(64);
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function fake() {
  const data=[{stateId:id(1),text:"第一件真实记忆"},{stateId:id(2),text:"第二件真实记忆"}];
  const e5Values=new Map([[id(1),.94],[id(2),.92]]);
  const ritValues=new Map([[id(1),.77],[id(2),.74]]);
  let active=false;
  let snapVersion=version;
  let failWarm=false;
  const e5={
    score:async (input:{query:string;candidates:readonly {stateId:string;text:string;kind:"memory"}[]})=>{
      if(failWarm)throw new Error("E5 failed.");
      return new Map(input.candidates.map(m=>[m.stateId,e5Values.get(m.stateId)??.5]));
    },
  };
  const ritrieve={
    warmup:async()=>undefined,
    score:async()=>new Map<string,number>(),
    replaceSnapshot:async()=>{active=true;},
    isSnapshotReady:()=>active,
    searchSnapshot:async()=>({version:snapVersion,count:data.length,
      hits:[...ritValues].sort((a,b)=>b[1]-a[1]).map(([stateId,score])=>({stateId,score}))}),
    close:async()=>{active=false;},
  };
  const service=new LocalHybridMindRecallScorer(
    e5 as unknown as Pick<LocalE5BreathSemanticScorer,"score">,
    ritrieve as unknown as Pick<LocalRitrieveBreathSemanticScorer,
      "score"|"warmup"|"replaceSnapshot"|"isSnapshotReady"|"searchSnapshot"|"close">);
  return {service,data,e5Values,ritValues,setVersion:(value:string)=>{snapVersion=value;},
    setWarmFailure:(value:boolean)=>{failWarm=value}};
}

test("real Hook hybrid uses two independent model signals and returns at most two",async()=>{
  const f=fake();
  assert.equal(f.service.isSnapshotReady(),false);
  await f.service.warmup();
  await f.service.replaceSnapshot({version,memories:f.data});
  const result=await f.service.searchHybrid("我们聊过什么");
  assert.deepEqual(result,{version,count:2,hits:[
    {stateId:id(1),score:.99},{stateId:id(2),score:.98},
  ]});
  assert.equal(result.hits.length,2);
  await f.service.close();
});

test("second candidate blocked when ritrieve confidence is not sufficient",async()=>{
  const f=fake();
  f.ritValues.set(id(2),.69);
  await f.service.replaceSnapshot({version,memories:f.data});
  assert.deepEqual((await f.service.searchHybrid("回忆")).hits,[{stateId:id(1),score:.99}]);
  await f.service.close();
});

test("neither model agrees: empty return, not a forced lexical recall",async()=>{
  const f=fake();
  f.ritValues.set(id(1),.58);
  f.ritValues.set(id(2),.57);
  await f.service.replaceSnapshot({version,memories:f.data});
  assert.deepEqual((await f.service.searchHybrid("远离记忆的无关问题")).hits,[]);
  await f.service.close();
});

test("stale or not yet prepared snapshot must reject",async()=>{
  const f=fake();
  await assert.rejects(f.service.searchHybrid("测试"),/unavailable/);
  await f.service.replaceSnapshot({version,memories:f.data});
  f.setVersion("b".repeat(64));
  await assert.rejects(f.service.searchHybrid("测试"),/changed/);
  await f.service.close();
});

test("corpus >256 refuses hybrid instead of quietly truncating E5 recall",async()=>{
  const f=fake();
  const rows=Array.from({length:257},(_,i)=>({stateId:id(i+1),text:"有效记忆"}));
  await assert.rejects(f.service.replaceSnapshot({version,memories:rows}),/bounded size/);
  assert.equal(f.service.isSnapshotReady(),false);
  await f.service.close();
});

test("failed E5 preencoding cannot advertise the index as ready",async()=>{
  const f=fake();
  f.setWarmFailure(true);
  await assert.rejects(f.service.replaceSnapshot({version,memories:f.data}),/E5 failed/);
  assert.equal(f.service.isSnapshotReady(),false);
  await f.service.close();
});
