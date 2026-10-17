import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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

test("quarantined Cron result recovers exact SDK output after server repairs a legacy Wake anchor",async t=>{
  const f=await fixture(t),blocked:string[]=[],recovered:string[]=[];
  let fixed=false,now=1_000,submissions=0;
  const relay={
    async prepareBackgroundResult(value:any){
      return {receiptId:value.receiptId,providerSessionId:"synthetic",
        parentProviderCheckpointId:value.parentProviderCheckpointId,
        expiresAt:new Date(Date.now()+600_000).toISOString()};
    },
    async submitBackgroundResult(value:any){
      submissions++;
      if(!fixed)throw Object.assign(new Error("old Wake anchor"),{relayCode:"BACKGROUND_CONFLICT",httpStatus:409});
      return {outcome:"committed" as const,duplicate:false,
        providerCheckpointId:value.result.provider_checkpoint_id};
    },
  };
  const sink=new NativeLiveMacBackgroundResultSink({
    listenerInstanceId:id(7),relay,outbox:f.outbox,now:()=>now,
    onRecoveryBlocked:async conversationId=>{blocked.push(conversationId);},
    onRecovered:async conversationId=>{recovered.push(conversationId);},
  });
  await assert.rejects(sink.commit(owner,frame),/old Wake anchor/);
  assert.equal(await sink.flush(),0,"409 quarantines immutable evidence, not another model run");
  assert.equal((await f.outbox.list()).length,0);
  assert.equal((await f.outbox.listQuarantined()).length,1);
  assert.deepEqual(blocked,[id(1)]);
  fixed=true;
  now+=60_001;
  assert.equal(await sink.flush(),1,"backend verifies and commits that exact original result");
  assert.deepEqual(await f.outbox.listQuarantined(),[]);
  assert.deepEqual(recovered,[id(1)],"recovery fence releases only after confirmed receipt");
  assert.equal(submissions,3,"initial 409, quarantine 409, one successful replay; never invoke Claude");
  assert.equal(await sink.flush(),0,"receipt cannot replay twice");
});

test("network-unknown recovery is backed off and later replays its original receipt exactly once",async t=>{
 const f=await fixture(t);let now=1000,attempts=0,available=false;const blocks:string[]=[],recovered:string[]=[];
 const relay={...f.relay,async prepareBackgroundResult(input:any){attempts++;if(!available)throw new TypeError("network unavailable");return f.relay.prepareBackgroundResult(input);}};
 const sink=new NativeLiveMacBackgroundResultSink({listenerInstanceId:id(7),relay,outbox:f.outbox,now:()=>now,onRecoveryBlocked:async(id:string)=>{blocks.push(id);},onRecovered:async(id:string)=>{recovered.push(id);}} as any);
 await assert.rejects(sink.commit(owner,frame));assert.equal(await sink.flush(),0);assert.equal(attempts,2);
 assert.equal(await sink.flush(),0);assert.equal(attempts,2,"backoff prevents every user message waiting on the broken receipt");
 available=true;now+=30000;assert.equal(await sink.flush(),1);assert.equal(f.committed.size,1);assert.deepEqual(recovered,[id(1)]);assert.ok(blocks.length>0);
});

test("relay failure fences foreground dispatch immediately, before timer-based recovery",async t=>{
  const f=await fixture(t),fenced:string[]=[];
  const relay={...f.relay,async prepareBackgroundResult():Promise<never>{
    throw new TypeError("network response unknown");
  }};
  const sink=new NativeLiveMacBackgroundResultSink({
    listenerInstanceId:id(7),relay,outbox:f.outbox,
    onImmediateFence:id=>fenced.push(id),
  });
  await assert.rejects(sink.commit(owner,frame),/unknown/);
  assert.deepEqual(fenced,[id(1)],"new input is fenced synchronously before the failed SDK acknowledgement escapes");
  assert.equal((await f.outbox.list()).length,1,"the original immutable reply survives");
});

test("recovery fencing may reenter the serial outbox without deadlocking", async t => {
  const f = await fixture(t);
  const blocked: string[] = [];
  const relay = { ...f.relay, async submitBackgroundResult() {
    return { outcome: "queued" as const, duplicate: false, providerCheckpointId: null };
  } };
  let sink!: NativeLiveMacBackgroundResultSink;
  sink = new NativeLiveMacBackgroundResultSink({
    listenerInstanceId: id(7), relay, outbox: f.outbox,
    isForegroundActive: () => false,
    onRecoveryBlocked: async conversationId => {
      blocked.push(conversationId);
      // A retiring writer may itself reenter the delivery queue. Calling this
      // while flush() holds its serial lock would wait on itself forever.
      await sink.cover(id(1), id(2), id(8));
    },
  });
  await sink.commit({ ...owner, deferred: true }, frame);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sink.flush(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("recovery callback deadlocked the outbox")), 1000);
      }),
    ]);
  } finally { clearTimeout(timeout); }
  assert.deepEqual(blocked, [id(1)]);
  assert.equal((await f.outbox.list())[0]!.coveringCheckpointId, id(8));
});

test("recovery-complete callback cannot hold up the outbox delivery lock", async t => {
  const f = await fixture(t);
  const receiptId = id(80);
  await f.outbox.save({
    sourcePrepareId: id(3), receiptId, listenerInstanceId: id(7),
    generationId: id(2), parentProviderCheckpointId: id(5),
    result: {
      protocol_version: 4, prepare_id: id(3), request_id: id(4),
      conversation_id: id(1), status: "success",
      provider_session_id: "synthetic", effective_working_directory: "/synthetic",
      provider_checkpoint_id: id(6), normalized_events: frame.normalizedEvents,
    },
  });
  let sink!: NativeLiveMacBackgroundResultSink, recovered = false;
  sink = new NativeLiveMacBackgroundResultSink({
    listenerInstanceId: id(7), relay: f.relay, outbox: f.outbox,
    onRecovered: async conversationId => {
      assert.equal(conversationId, id(1));
      recovered = true;
      await sink.cover(id(1), id(2), id(8));
    },
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    assert.equal(await Promise.race([
      sink.flush(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("recovered callback deadlocked the outbox")), 1000);
      }),
    ]), 1);
  } finally { clearTimeout(timeout); }
  assert.equal(recovered, true);
  assert.deepEqual(await f.outbox.list(), []);
});

test("recovery fence release is retried after its last receipt has already been acknowledged", async t => {
  const f = await fixture(t);
  f.lose();
  await assert.rejects(f.sink.commit(owner, frame));
  let attempts = 0;
  const sink = new NativeLiveMacBackgroundResultSink({
    listenerInstanceId: id(7), relay: f.relay, outbox: f.outbox,
    onRecovered: async conversationId => {
      assert.equal(conversationId, id(1));
      if (++attempts === 1) throw new Error("old writer could not be retired");
    },
  });
  assert.equal(await sink.flush(), 1, "the original provider result is already committed");
  assert.equal(attempts, 1);
  assert.deepEqual(await f.outbox.list(), [], "a released transport receipt must not be regenerated");
  assert.equal(await sink.flush(), 0, "empty-outbox recovery still retries failed retirement");
  assert.equal(attempts, 2);
  assert.equal(await sink.flush(), 0);
  assert.equal(attempts, 2, "successful recovery completion is not repeated");
});

test("concurrent recovery flushes do not retire the same writer twice", async t => {
  const f = await fixture(t);
  f.lose();
  await assert.rejects(f.sink.commit(owner, frame));
  let entered!: () => void, release!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const sink = new NativeLiveMacBackgroundResultSink({
    listenerInstanceId: id(7), relay: f.relay, outbox: f.outbox,
    onRecovered: async () => { calls++; entered(); await hold; },
  });
  const first = sink.flush();
  await started;
  const second = sink.flush();
  try {
    assert.equal(await second, 0);
    assert.equal(calls, 1, "another timer tick must not reenter a retiring writer");
  } finally { release(); }
  assert.equal(await first, 1);
  assert.equal(calls, 1);
});

test("deferred background is acknowledged queued but is only deleted after F covering checkpoint commits",async t=>{
  const f=await fixture(t);const checks:Array<string|null>=[];
  const relay={...f.relay,async submitBackgroundResult(input:any){
    checks.push(input.coveringCheckpointId??null);
    return input.coveringCheckpointId
      ?{outcome:"committed" as const,duplicate:false,providerCheckpointId:input.coveringCheckpointId}
      :{outcome:"queued" as const,duplicate:false,providerCheckpointId:null};
  }};
  const sink=new NativeLiveMacBackgroundResultSink({listenerInstanceId:id(7),relay,outbox:f.outbox});
  assert.deepEqual(await sink.commit({...owner,deferred:true},frame),{status:"queued",providerCheckpointId:id(6)});
  assert.equal((await f.outbox.list()).length,1,"queued is not canonical completion");
  assert.deepEqual(checks,[null]);
  assert.equal(await sink.cover(id(1),id(2),id(8)),1);
  assert.equal((await f.outbox.list())[0]!.coveringCheckpointId,id(8),"covering F checkpoint is fsynced before F publication");
  await sink.publishCovered(id(1),id(2));
  assert.deepEqual(checks,[null,id(8)]);
  assert.equal((await f.outbox.list()).length,0,"only a committed durable reply clears outbox evidence");
});

test("covered but not canonically published cannot masquerade as successful recovery",async t=>{
  const f=await fixture(t);const blocked:string[]=[];
  const relay={...f.relay,async submitBackgroundResult(){
    return{outcome:"queued" as const,duplicate:true,providerCheckpointId:null};
  }};
  const sink=new NativeLiveMacBackgroundResultSink({listenerInstanceId:id(7),relay,outbox:f.outbox,
    onRecoveryBlocked:async id=>{blocked.push(id);}});
  assert.deepEqual(await sink.commit({...owner,deferred:true},frame),{status:"queued",providerCheckpointId:id(6)});
  await sink.cover(id(1),id(2),id(8));
  await assert.rejects(sink.publishCovered(id(1),id(2)),/queued reply|still queued/i);
  assert.equal((await f.outbox.list()).length,1,"a covering proof is not a committed receipt");
  assert.equal(await sink.flush(),0);
  assert.deepEqual(blocked,[id(1)],"daemon must fence writer while covered output is uncommitted");
  assert.equal((await f.outbox.list()).length,1);
});

test("daemon periodic flush cannot publish covered B before its active F commits",async t=>{
  const f=await fixture(t);let foregroundActive=true,submitCount=0;
  const relay={...f.relay,async submitBackgroundResult(input:any){
    submitCount++;
    return input.coveringCheckpointId
      ?{outcome:"committed" as const,duplicate:false,providerCheckpointId:input.coveringCheckpointId}
      :{outcome:"queued" as const,duplicate:false,providerCheckpointId:null};
  }};
  const sink=new NativeLiveMacBackgroundResultSink({listenerInstanceId:id(7),relay,outbox:f.outbox,
    isForegroundActive:()=>foregroundActive});
  await sink.commit({...owner,deferred:true},frame);
  await sink.cover(id(1),id(2),id(8));
  assert.equal(await sink.flush(),0,"covered evidence is not yet canonical while F is active");
  assert.equal(submitCount,1,"must not send early covered B to backend");
  assert.equal((await f.outbox.list()).length,1);
  foregroundActive=false;
  await sink.publishCovered(id(1),id(2));
  assert.equal(submitCount,2);
  assert.equal((await f.outbox.list()).length,0);
});

test("post-F drain fences a late deferred B that missed the covering snapshot",async t=>{
  const f=await fixture(t),fences:string[]=[];
  const sink=new NativeLiveMacBackgroundResultSink({
    listenerInstanceId:id(7),relay:f.relay,outbox:f.outbox,
    onImmediateFence:id=>fences.push(id),
  });
  await f.outbox.save({
    sourcePrepareId:id(3),receiptId:id(80),listenerInstanceId:id(7),
    generationId:id(2),parentProviderCheckpointId:id(5),deferred:true,
    result:{
      protocol_version:4,prepare_id:id(3),request_id:id(4),conversation_id:id(1),
      status:"success",provider_session_id:"synthetic",effective_working_directory:"/synthetic",
      provider_checkpoint_id:id(6),normalized_events:frame.normalizedEvents,
    },
  });
  await assert.rejects(sink.publishCovered(id(1),id(2)),/Uncovered autonomous output/);
  assert.deepEqual(fences,[id(1)]);
  assert.equal((await f.outbox.list()).length,1,"late B remains recoverable, never silently cleared");
});

test("orphaned deferred background is fenced after foreground failure or daemon restart",async t=>{
  const f=await fixture(t);let active=true;const blocked:string[]=[];
  const relay={...f.relay,async submitBackgroundResult(){
    return{outcome:"queued" as const,duplicate:false,providerCheckpointId:null};
  }};
  const sink=new NativeLiveMacBackgroundResultSink({listenerInstanceId:id(7),relay,outbox:f.outbox,
    isForegroundActive:()=>active,onRecoveryBlocked:async id=>{blocked.push(id);}});
  await sink.commit({...owner,deferred:true},frame);
  assert.equal(await sink.flush(),0);
  assert.deepEqual(blocked,[],"live foreground F must not be retired by the periodic outbox scan");
  active=false;
  assert.equal(await sink.flush(),0);
  assert.deepEqual(blocked,[id(1)]);
  assert.equal((await f.outbox.list()).length,1,"uncertain result remains durable until covering proof can be recovered");
});

test("post-F drain never publishes B2 from a partially written covering journal", async t => {
  const f = await fixture(t), fences: string[] = [];
  const saved = (receiptId: string, parent: string, produced: string, covered?: string) => ({
    sourcePrepareId: id(3), receiptId, listenerInstanceId: id(7),
    generationId: id(2), parentProviderCheckpointId: parent, deferred: true,
    ...(covered ? { coveringCheckpointId: covered } : {}),
    result: {
      protocol_version: 4 as const, prepare_id: id(3), request_id: id(4),
      conversation_id: id(1), status: "success" as const,
      provider_session_id: "synthetic", effective_working_directory: "/synthetic",
      provider_checkpoint_id: produced, normalized_events: frame.normalizedEvents,
    },
  });
  await f.outbox.save(saved(id(80), id(5), id(6)));
  await f.outbox.save(saved(id(81), id(6), id(9), id(8)));
  const sink = new NativeLiveMacBackgroundResultSink({
    listenerInstanceId: id(7), relay: f.relay, outbox: f.outbox,
    onImmediateFence: value => fences.push(value),
  });
  await assert.rejects(sink.publishCovered(id(1), id(2)), /Uncovered autonomous output/);
  assert.equal(f.calls.length, 0, "B2 must not even reach HTTP before B1 has coverage");
  assert.deepEqual(fences, [id(1)]);
  assert.deepEqual((await f.outbox.list()).map(x => x.receiptId), [id(80), id(81)]);
});

test("recovery cannot skip an earlier queued B1 to publish covered B2 in the same conversation", async t => {
  const f = await fixture(t), submitted: string[] = [];
  const saved = (receiptId: string, conversationId: string, parent: string, produced: string, deferred = false, covered?: string) => ({
    sourcePrepareId: id(3), receiptId, listenerInstanceId: id(7),
    generationId: id(2), parentProviderCheckpointId: parent,
    ...(deferred ? { deferred: true } : {}),
    ...(covered ? { coveringCheckpointId: covered } : {}),
    result: {
      protocol_version: 4 as const, prepare_id: id(3), request_id: id(4),
      conversation_id: conversationId, status: "success" as const,
      provider_session_id: "synthetic", effective_working_directory: "/synthetic",
      provider_checkpoint_id: produced, normalized_events: frame.normalizedEvents,
    },
  });
  await f.outbox.save(saved(id(80), id(1), id(5), id(6), true));
  await f.outbox.save(saved(id(81), id(1), id(6), id(9), true, id(8)));
  await f.outbox.save(saved(id(82), id(20), id(5), id(10)));
  const relay = {
    async prepareBackgroundResult(value: any) {
      return { receiptId: value.receiptId, providerSessionId: "synthetic",
        parentProviderCheckpointId: value.parentProviderCheckpointId, expiresAt: new Date(Date.now() + 600000).toISOString() };
    },
    async submitBackgroundResult(value: any) {
      submitted.push(value.receiptId);
      return { outcome: "committed" as const, duplicate: false,
        providerCheckpointId: value.coveringCheckpointId ?? value.result.provider_checkpoint_id };
    },
  };
  const sink = new NativeLiveMacBackgroundResultSink({ listenerInstanceId: id(7), relay, outbox: f.outbox });
  assert.equal(await sink.flush(), 1, "an independent conversation remains recoverable");
  assert.deepEqual(submitted, [id(82)], "B2 cannot bypass still-uncovered B1");
  assert.deepEqual((await f.outbox.list()).map(x => x.receiptId), [id(80), id(81)]);
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

test("crash after receipt fsync but before index rename is reconciled before next save", async t => {
  const f = await fixture(t);
  const directory = (f.outbox as any).directory as string;
  const hashed = (receiptId: string) => createHash("sha256")
    .update(JSON.stringify([id(7), id(2), receiptId])).digest("hex") + ".json";
  const first = id(100);
  let second = id(101);
  for (let n = 101; n < 2000 && hashed(second) >= hashed(first); n++) second = id(n + 1);
  assert.ok(hashed(second) < hashed(first), "filename order must oppose generation order");
  const receipt = (receiptId: string, parent: string, providerCheckpointId: string) => ({
    sourcePrepareId: id(3), receiptId, listenerInstanceId: id(7), generationId: id(2),
    parentProviderCheckpointId: parent,
    result: {
      protocol_version: 4 as const, prepare_id: id(3), request_id: id(4),
      conversation_id: id(1), status: "success" as const,
      provider_session_id: "synthetic", effective_working_directory: "/synthetic",
      provider_checkpoint_id: providerCheckpointId, normalized_events: frame.normalizedEvents,
    },
  });
  const a = receipt(first, id(5), id(6)), b = receipt(second, id(6), id(8));
  await f.outbox.save(a);
  // Simulate a crash exactly between renaming A's fsynced payload and
  // renaming the separately fsynced order index: A exists but is unindexed.
  writeFileSync(join(directory, ".delivery-order.json"), "[]");
  const recovered = new NativeLiveMacBackgroundResultOutbox(directory);
  assert.deepEqual((await recovered.list()).map(x => x.receiptId), [first]);
  await recovered.save(b);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, ".delivery-order.json"), "utf8")),
    [hashed(first), hashed(second)], "the next save must journal old orphan A before new B");
  const restarted = new NativeLiveMacBackgroundResultOutbox(directory);
  assert.deepEqual((await restarted.list()).map(x => x.receiptId), [first, second]);
});

