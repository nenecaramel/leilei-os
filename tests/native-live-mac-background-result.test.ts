import assert from "node:assert/strict";
import test from "node:test";
import { NativeLiveMacHttpRelayClient } from "../src/domains/bridge/mac/native-live-mac-http-relay-client.js";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { sourcePrepareId:id(1), receiptId:id(2), listenerInstanceId:id(3), generationId:id(4) };
const prepared = { receiptId:id(2), providerSessionId:"synthetic", parentProviderCheckpointId:id(5), expiresAt:new Date(Date.now()+600_000).toISOString() };
const result = { protocol_version:4 as const, prepare_id:id(1), request_id:id(6), conversation_id:id(7), status:"success" as const, provider_session_id:"synthetic", provider_checkpoint_id:id(8), effective_working_directory:"/synthetic", normalized_events:[] };
const response = (data:unknown) => new Response(JSON.stringify({success:true,data}),{headers:{"content-type":"application/json"}});

test("Mac background receipts use exact authenticated two-phase identities and bounded requests", async () => {
  const calls:Array<{url:string;body:any;signal:AbortSignal|null|undefined}>=[];
  const client=new NativeLiveMacHttpRelayClient("https://relay.invalid","synthetic",async (url,init)=>{
    assert.equal(new Headers(init?.headers).get("authorization"),"Bearer synthetic");
    calls.push({url:String(url),body:JSON.parse(String(init?.body)),signal:init?.signal});
    return response(calls.length===1?prepared:{outcome:"committed",duplicate:false,providerCheckpointId:id(8)});
  });
  assert.deepEqual(await client.prepareBackgroundResult({...identity,parentProviderCheckpointId:id(5)}),prepared);
  assert.deepEqual(await client.submitBackgroundResult({...identity,result}),{outcome:"committed",duplicate:false,providerCheckpointId:id(8)});
  assert.ok(calls.every(c=>c.signal instanceof AbortSignal));
  assert.ok(calls[0]!.url.endsWith(`/reservations/${id(1)}/background-results/prepare`));
  assert.deepEqual(calls[0]!.body,{receipt_id:id(2),listener_instance_id:id(3),generation_id:id(4),parent_provider_checkpoint_id:id(5)});
  assert.ok(calls[1]!.url.endsWith(`/reservations/${id(1)}/background-results/${id(2)}/result`));
  assert.equal(calls[1]!.body.result.prepare_id,id(1));
});

for (const data of [{...prepared,receiptId:id(9)},{...prepared,parentProviderCheckpointId:id(9)},{...prepared,providerSessionId:""},{...prepared,expiresAt:"invalid"}]) test("Mac rejects a mismatched or malformed background preparation",async()=>{
  const client=new NativeLiveMacHttpRelayClient("https://relay.invalid","synthetic",async()=>response(data));
  await assert.rejects(client.prepareBackgroundResult({...identity,parentProviderCheckpointId:id(5)}));
});
for(const data of [{outcome:"committed",duplicate:false,providerCheckpointId:id(9)},{outcome:"stale",duplicate:false,providerCheckpointId:id(8)},{outcome:"committed",duplicate:"yes",providerCheckpointId:id(8)}]) test("Mac refuses an invalid background commit acknowledgement",async()=>{
  const client=new NativeLiveMacHttpRelayClient("https://relay.invalid","synthetic",async()=>response(data));
  await assert.rejects(client.submitBackgroundResult({...identity,result}));
});
test("lost background response retries the same receipt and result, never a fresh task",async()=>{
  const bodies:string[]=[];
  const client=new NativeLiveMacHttpRelayClient("https://relay.invalid","synthetic",async(_url,init)=>{
    bodies.push(String(init?.body)); if(bodies.length===1)throw new TypeError("synthetic lost response");
    return response({outcome:"committed",duplicate:true,providerCheckpointId:id(8)});
  });
  assert.equal((await client.submitBackgroundResult({...identity,result})).duplicate,true);
  assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);
});
test("quiet acknowledgement survives HTTP mapping and rejects malformed checkpoints",async()=>{
  const client=new NativeLiveMacHttpRelayClient("https://relay.invalid","synthetic",async()=>response({canonicalOutcome:"wake_quiet",nativeResumeCheckpointId:id(8)}));
  assert.deepEqual(await client.submitResult({listenerInstanceId:id(3),reservationId:id(1),result}),{canonicalOutcome:"wake_quiet",nativeResumeCheckpointId:id(8)});
  const bad=new NativeLiveMacHttpRelayClient("https://relay.invalid","synthetic",async()=>response({canonicalOutcome:"wake_quiet",nativeResumeCheckpointId:"invalid"}));
  await assert.rejects(bad.submitResult({listenerInstanceId:id(3),reservationId:id(1),result}));
});

test("background HTTP deadline aborts a hung response and does not retry past the shared budget",{timeout:7000},async()=>{
 let calls=0;
 const client=new NativeLiveMacHttpRelayClient("https://relay.invalid","synthetic",async(_url,init)=>{
  calls++;return new Promise((_resolve,reject)=>init!.signal!.addEventListener("abort",()=>reject(init!.signal!.reason),{once:true}));
 });
 const keepAlive=setInterval(()=>{},1000);
 try { await assert.rejects(client.prepareBackgroundResult({...identity,parentProviderCheckpointId:id(5)}));assert.equal(calls,1); } finally {clearInterval(keepAlive);}
});
