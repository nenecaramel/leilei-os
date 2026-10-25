import assert from "node:assert/strict";
import test from "node:test";
import { NativeLiveMacHttpRelayClient } from "../src/domains/bridge/mac/native-live-mac-http-relay-client.js";
import { createNativeLiveRelayInternalRouter } from "../src/web-api/native-live-relay-internal-router.js";
import { FakeRelayService, withServer, userId, listenerId, prepareId, requestId, conversationId } from "./helpers/native-live-http-relay-fixtures.js";
const body={listener_instance_id:listenerId,request_id:requestId,conversation_id:conversationId,runtime_mode:"new",canonical_user_message_id:null,parent_provider_session_id:null,parent_provider_checkpoint_id:null};
test("execution renewal authenticates and accepts only exact reservation identity fields",async()=>{
 const calls:any[]=[];const service=Object.assign(new FakeRelayService(),{async renewExecutionLease(input:any){calls.push(input);return true;}});
 await withServer(app=>app.use("/relay",createNativeLiveRelayInternalRouter({relayService:service})),async base=>{
  assert.equal((await fetch(`${base}/relay/reservations/${prepareId}/execution-lease/renew`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})).status,401);
 });
 await withServer(app=>{app.use((req,_res,next)=>{req.mcpUserId=userId;next();});app.use("/relay",createNativeLiveRelayInternalRouter({relayService:service}));},async base=>{
  const url=`${base}/relay/reservations/${prepareId}/execution-lease/renew`;
  assert.equal((await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,prompt:"must not be accepted"})})).status,400);
  const good=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});assert.equal(good.status,200);assert.deepEqual(await good.json(),{success:true,data:{renewed:true}});
 });assert.equal(calls.length,1);assert.equal(calls[0].userId,userId);assert.equal(calls[0].reservationId,prepareId);
});
test("Mac execution renewal is a single bounded request, not late-result ownership or listener reacquisition",async()=>{
 const calls:any[]=[];const client=new NativeLiveMacHttpRelayClient("https://relay.invalid","synthetic",async(url,init)=>{calls.push({url:String(url),init});return new Response(JSON.stringify({success:true,data:{renewed:true}}),{headers:{"content-type":"application/json"}});});
 const command={protocol_version:4,dispatch_target:"claude_code",prepare_id:prepareId,request_id:requestId,conversation_id:conversationId,operation:"send",runtime_mode:"new",canonical_user_message_id:null,parent_provider_session_id:null,parent_provider_checkpoint_id:null,expected_working_directory:null,prompt:"synthetic"} as const;
 assert.equal(await client.renewExecutionLease({listenerInstanceId:listenerId,command}),true);assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith(`/reservations/${prepareId}/execution-lease/renew`));assert.ok(calls[0].init.signal instanceof AbortSignal);assert.deepEqual(JSON.parse(calls[0].init.body),body);
});

test("only reserve accepts the explicit persistent-session capability; old requests keep their shape",async()=>{
 const service=new FakeRelayService();const calls:any[]=[];service.reserveNext=async(input:any)=>{calls.push(input);return null;};
 await withServer(app=>{app.use((req,_res,next)=>{req.mcpUserId=userId;next();});app.use("/relay",createNativeLiveRelayInternalRouter({relayService:service}));},async base=>{
  const send=(path:string,value:any)=>fetch(`${base}/relay/${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(value)});
  const old={listener_instance_id:listenerId,dispatch_target:"claude_code"};
  assert.equal((await send("reserve",old)).status,200);
  assert.equal((await send("reserve",{...old,persistent_sessions:true})).status,200);
  assert.equal((await send("reserve",{...old,persistent_sessions:"true"})).status,400);
  assert.equal((await send("lease/renew",{...old,persistent_sessions:true})).status,400);
 });assert.equal(calls.length,2);assert.equal(calls[0].persistentSessions,undefined);assert.equal(calls[1].persistentSessions,true);
});

test("reserve accepts an explicit idle result outbox flag and nothing else in its place",async()=>{
 const service=new FakeRelayService();const calls:any[]=[];service.reserveNext=async(input:any)=>{calls.push(input);return null;};
 await withServer(app=>{app.use((req,_res,next)=>{req.mcpUserId=userId;next();});app.use("/relay",createNativeLiveRelayInternalRouter({relayService:service}));},async base=>{
  const send=(path:string,value:any)=>fetch(`${base}/relay/${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(value)});
  const old={listener_instance_id:listenerId,dispatch_target:"claude_code"};
  assert.equal((await send("reserve",{...old,persistent_sessions:true,result_outbox_idle:true})).status,200);
  assert.equal((await send("reserve",{...old,result_outbox_idle:false})).status,200);
  assert.equal((await send("reserve",{...old,result_outbox_idle:"true"})).status,400);
  assert.equal((await send("lease/renew",{...old,result_outbox_idle:true})).status,400);
 });assert.equal(calls.length,2);assert.equal(calls[0].resultOutboxIdle,true);assert.equal(calls[0].persistentSessions,true);assert.equal(calls[1].resultOutboxIdle,undefined);
});

test("session lease renewal authenticates and never reacquires the listener",async()=>{
 const calls:any[]=[];const service=Object.assign(new FakeRelayService(),{async renewSessionLease(input:any){calls.push(input);return false;}});
 await withServer(app=>{app.use((req,_res,next)=>{req.mcpUserId=userId;next();});app.use("/relay",createNativeLiveRelayInternalRouter({relayService:service}));},async base=>{
  const result=await fetch(`${base}/relay/session-lease/renew`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({listener_instance_id:listenerId,dispatch_target:"claude_code"})});assert.equal(result.status,200);assert.deepEqual(await result.json(),{success:true,data:{renewed:false}});
 });assert.equal(calls.length,1);
 const client=new NativeLiveMacHttpRelayClient("https://relay.invalid","synthetic",async(_url,init)=>{assert.ok(init?.signal instanceof AbortSignal);return new Response(JSON.stringify({success:true,data:{renewed:false}}));});assert.equal(await (client as any).renewSessionLease({listenerInstanceId:listenerId}),false);
});
