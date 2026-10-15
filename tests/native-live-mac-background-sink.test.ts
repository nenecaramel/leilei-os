import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeLiveMacBackgroundResultSink, NativeLiveMacBackgroundResultOutbox } from "../src/domains/bridge/mac/native-live-mac-background-result-sink.js";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const owner={conversationId:id(1),generationId:id(2),source:{prepareId:id(3),requestId:id(4)},providerSessionId:"synthetic",parentProviderCheckpointId:id(5),workingDirectory:"/synthetic"};
const frame={result:{session_id:"synthetic"},events:[],normalizedEvents:[{type:"text" as const,payload:{text:"synthetic"}}],providerCheckpointId:id(6)};
async function fixture(t:test.TestContext){
 const dir=await mkdtemp(join(tmpdir(),"background-sink-"));t.after(()=>rm(dir,{recursive:true,force:true}));
 const outbox=new NativeLiveMacBackgroundResultOutbox(dir), calls:any[]=[];
 let lost=false;const committed=new Set<string>();
 const relay={async prepareBackgroundResult(input:any){calls.push(["prepare",structuredClone(input)]);assert.equal((await outbox.list()).length,1,"persist before first HTTP");return {receiptId:input.receiptId,providerSessionId:"synthetic",parentProviderCheckpointId:id(5),expiresAt:new Date(Date.now()+600000).toISOString()};},async submitBackgroundResult(input:any){calls.push(["submit",structuredClone(input)]);const duplicate=committed.has(input.receiptId);committed.add(input.receiptId);if(lost){lost=false;throw new TypeError("response lost");}return {outcome:"committed" as const,duplicate,providerCheckpointId:id(6)};}};
 return {outbox,calls,committed,relay,lose(){lost=true;},sink:new NativeLiveMacBackgroundResultSink({listenerInstanceId:id(7),relay,outbox})};
}
test("background sink persists independent source/parent identity then acknowledges the exact committed cursor",async t=>{
 const f=await fixture(t);assert.deepEqual(await f.sink.commit(owner,frame),{status:"applied",providerCheckpointId:id(6)});
 assert.equal((await f.outbox.list()).length,0);assert.deepEqual(f.calls.map(c=>c[0]),["prepare","submit"]);
 const body=f.calls[1][1];assert.equal(body.sourcePrepareId,id(3));assert.equal(body.result.prepare_id,id(3));assert.equal(body.result.request_id,id(4));assert.equal(body.result.conversation_id,id(1));assert.equal(body.result.provider_checkpoint_id,id(6));
});
test("lost response survives sink restart and replays only the original receipt, never provider execution",async t=>{
 const f=await fixture(t);f.lose();await assert.rejects(f.sink.commit(owner,frame));
 const pending=await f.outbox.list();assert.equal(pending.length,1);assert.equal(f.committed.size,1);
 const restarted=new NativeLiveMacBackgroundResultSink({listenerInstanceId:id(99),relay:f.relay,outbox:f.outbox});
 assert.equal(await restarted.flush(),1);assert.equal(f.committed.size,1);assert.equal((await f.outbox.list()).length,0);
 assert.equal(f.calls[1][1].receiptId,f.calls[3][1].receiptId);assert.equal(f.calls[3][1].listenerInstanceId,id(7),"retry retains original listener identity");
});
test("background sink refuses missing visible source and unbound attachments before persistence/network",async t=>{
 const f=await fixture(t);await assert.rejects(f.sink.commit({...owner,source:null},frame));
 await assert.rejects(f.sink.commit(owner,{...frame,normalizedEvents:[{type:"attachment",payload:{attachment_id:id(9)}}]}));
 assert.equal(f.calls.length,0);assert.equal((await f.outbox.list()).length,0);
});
test("stale result is acknowledged locally without advancing the persistent writer",async t=>{
 const f=await fixture(t);const relay={...f.relay,async submitBackgroundResult(){return {outcome:"stale" as const,duplicate:false,providerCheckpointId:null};}};
 const sink=new NativeLiveMacBackgroundResultSink({listenerInstanceId:id(7),relay,outbox:f.outbox});
 assert.deepEqual(await sink.commit(owner,frame),{status:"rejected"});assert.equal((await f.outbox.list()).length,0);
});

test("an unpreparable receipt is quarantined and fenced without starving another conversation",async t=>{
 const f=await fixture(t);const blocked:string[]=[];let broken=true;
 const relay={...f.relay,async prepareBackgroundResult(input:any){if(broken)throw Object.assign(new Error("rejected"),{relayCode:"BACKGROUND_CONFLICT",httpStatus:409});return {receiptId:input.receiptId,providerSessionId:"synthetic",parentProviderCheckpointId:id(5),expiresAt:new Date(Date.now()+600000).toISOString()};}};
 const sink=new NativeLiveMacBackgroundResultSink({listenerInstanceId:id(7),relay,outbox:f.outbox,onRecoveryBlocked:async(id:string)=>{blocked.push(id);}} as any);
 await assert.rejects(sink.commit(owner,frame));assert.equal(await sink.flush(),0);assert.deepEqual(blocked,[id(1)]);
 assert.equal((await f.outbox.list()).length,0);assert.equal((await (f.outbox as any).listQuarantined()).length,1);
 broken=false;assert.deepEqual(await sink.commit({...owner,conversationId:id(20)},frame),{status:"applied",providerCheckpointId:id(6)});
 assert.equal((await (f.outbox as any).listQuarantined()).length,1,"uncertain evidence remains durable");
});

test("network-unknown recovery is backed off and later replays its original receipt exactly once",async t=>{
 const f=await fixture(t);let now=1000,attempts=0,available=false;const blocks:string[]=[],recovered:string[]=[];
 const relay={...f.relay,async prepareBackgroundResult(input:any){attempts++;if(!available)throw new TypeError("network unavailable");return f.relay.prepareBackgroundResult(input);}};
 const sink=new NativeLiveMacBackgroundResultSink({listenerInstanceId:id(7),relay,outbox:f.outbox,now:()=>now,onRecoveryBlocked:async(id:string)=>{blocks.push(id);},onRecovered:async(id:string)=>{recovered.push(id);}} as any);
 await assert.rejects(sink.commit(owner,frame));assert.equal(await sink.flush(),0);assert.equal(attempts,2);
 assert.equal(await sink.flush(),0);assert.equal(attempts,2,"backoff prevents every user message waiting on the broken receipt");
 available=true;now+=30000;assert.equal(await sink.flush(),1);assert.equal(f.committed.size,1);assert.deepEqual(recovered,[id(1)]);assert.ok(blocks.length>0);
});
