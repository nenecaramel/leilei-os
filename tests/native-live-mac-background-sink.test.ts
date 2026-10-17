import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
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
test("stale HTTP 200 does not silently delete an undelivered background reply",async t=>{
  const f=await fixture(t);const blocked:string[]=[];
  const relay={...f.relay,async submitBackgroundResult(){return {outcome:"stale" as const,duplicate:false,providerCheckpointId:null};}};
  const sink=new NativeLiveMacBackgroundResultSink({listenerInstanceId:id(7),relay,outbox:f.outbox,
    onRecoveryBlocked:async(conversationId:string)=>{blocked.push(conversationId);}});
  await assert.rejects(sink.commit(owner,frame), /stale/i);
  assert.equal((await f.outbox.list()).length,0,"stale result must not be redelivered as a normal success");
  const evidence=await f.outbox.listQuarantined();
  assert.equal(evidence.length,1,"failed background reply remains durably recoverable");
  assert.equal(evidence[0]!.result.provider_checkpoint_id,id(6));
  assert.deepEqual(blocked,[],"callback must not deadlock by retiring its own writer");
  assert.equal(await sink.flush(),0);
  assert.deepEqual(blocked,[id(1)],"recovery pass fences after the original SDK acknowledgement has unwound");
  assert.equal((await f.outbox.listQuarantined()).length,1,"restart/recovery must retain rejected evidence");
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

test("restart replays background segments in persisted SDK order, not hash filename order", async t => {
  const f = await fixture(t);
  const listenerInstanceId = id(7), generationId = id(2);
  const digest = (receiptId: string) => createHash("sha256")
    .update(JSON.stringify([listenerInstanceId,generationId,receiptId])).digest("hex");
  const first = id(100);
  let second = id(101);
  // Force filenames to sort in the opposite order to SDK generation.
  for (let n=101; n<2000 && digest(second)>=digest(first); n++) second=id(n+1);
  assert.ok(digest(second)<digest(first));
  const result = (receiptId: string, parentProviderCheckpointId: string, checkpointId: string) => ({
    sourcePrepareId: id(3), receiptId, listenerInstanceId, generationId,
    parentProviderCheckpointId,
    result: { protocol_version: 4 as const, prepare_id: id(3), request_id: id(4),
      conversation_id: id(1), status: "success" as const,
      provider_session_id: "synthetic", effective_working_directory: "/synthetic",
      provider_checkpoint_id: checkpointId, normalized_events: frame.normalizedEvents },
  });
  const a=result(first,id(5),id(6)), b=result(second,id(6),id(8));
  await f.outbox.save(a);
  await f.outbox.save(b);
  const recovered = new NativeLiveMacBackgroundResultOutbox((f.outbox as any).directory);
  assert.deepEqual((await recovered.list()).map(row => row.receiptId),[first,second]);
  await recovered.acknowledge(a);
  assert.deepEqual((await new NativeLiveMacBackgroundResultOutbox((f.outbox as any).directory).list()).map(row => row.receiptId),[second]);
  await recovered.quarantine(b);
  assert.deepEqual((await recovered.list()).map(row => row.receiptId),[]);
  assert.deepEqual((await recovered.listQuarantined()).map(row => row.receiptId),[second]);
});
