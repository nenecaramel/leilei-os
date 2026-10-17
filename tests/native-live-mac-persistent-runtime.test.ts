import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeLiveMacPersistentRuntime } from "../src/domains/bridge/mac/native-live-mac-persistent-runtime.js";
import { NativeLiveMacBackgroundResultOutbox } from "../src/domains/bridge/mac/native-live-mac-background-result-sink.js";
import { createNativeLiveMacClaudeTransport } from "../src/domains/bridge/mac/native-live-mac-claude-transport.js";
import { NativeLiveMacHttpRelayClient } from "../src/domains/bridge/mac/native-live-mac-http-relay-client.js";
import type { NativeLiveRuntimeCommand } from "../src/domains/bridge/protocol/native-live-runtime-protocol.js";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function queue<T>(){const values:T[]=[];let wake:((value:IteratorResult<T>)=>void)|null=null,ended=false;return {push(v:T){if(wake){const r=wake;wake=null;r({value:v,done:false});}else values.push(v);},end(){ended=true;wake?.({value:undefined,done:true});wake=null;},[Symbol.asyncIterator](){return this;},next():Promise<IteratorResult<T>>{if(values.length)return Promise.resolve({value:values.shift()!,done:false});if(ended)return Promise.resolve({value:undefined,done:true});return new Promise(r=>wake=r);}};}

test("composed persistent runtime keeps one SDK writer across foreground, autonomous result and quiet wake",async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),"persistent-runtime-")));t.after(()=>rm(root,{recursive:true,force:true}));
 const frames=queue<any>(),inputs=queue<any>(),calls:any[]=[];let launches=0,closes=0,next=100,quiet=false;let taskAffordance:unknown;
 let leaseAlive=true,leaseTick:(()=>Promise<void>)|null=null;
 const transcript:any[]=[];
 let releaseReadback!:()=>void,enteredReadback!:()=>void;const readbackEntered=new Promise<void>(r=>enteredReadback=r),readbackReleased=new Promise<void>(r=>releaseReadback=r);let sampled=false;
 const relay=new NativeLiveMacHttpRelayClient("https://relay.invalid","synthetic",async(url,init)=>{
  const body=JSON.parse(String(init?.body));calls.push({url:String(url),body});
  if(String(url).endsWith("/task-controls/wait"))return await new Promise<Response>((_resolve,reject)=>{
   const cancel=()=>reject(new DOMException("Aborted","AbortError"));init?.signal?.addEventListener("abort",cancel,{once:true});if(init?.signal?.aborted)cancel();
  });
  const data=String(url).endsWith("/task-controls/capabilities")?{version:1}:String(url).endsWith("session-lease/renew")?{renewed:leaseAlive}:String(url).endsWith("execution-admission")?{admitted:true}:String(url).endsWith("execution-lease/renew")?{renewed:true}:String(url).endsWith("/input-binding")?{bound:{userMessageId:body.command_uuid,parentProviderCheckpointId:body.parent_provider_checkpoint_id}}:String(url).endsWith("/background-results/prepare")?{receiptId:body.receipt_id,providerSessionId:id(90),parentProviderCheckpointId:body.parent_provider_checkpoint_id,expiresAt:new Date(Date.now()+600000).toISOString()}:String(url).includes("background-results")?{outcome:"committed",duplicate:false,providerCheckpointId:body.result.provider_checkpoint_id}:{canonicalOutcome:quiet?"wake_quiet":"completed",...(quiet?{nativeResumeCheckpointId:body.result.provider_checkpoint_id}:{})};
  return new Response(JSON.stringify({success:true,data}),{headers:{"content-type":"application/json"}});
 });
 const runtime=new NativeLiveMacPersistentRuntime({sessionLeaseScheduler:{schedule(work:()=>Promise<void>){leaseTick=work;return work;},cancel(){leaseTick=null;}},environment:{},defaultWorkingDirectory:root,listenerInstanceId:id(91),relay,outboxDirectory:join(root,"outbox"),attachmentMaterializer:null,outputAttachmentSender:null,async createTransport(...args){
  const value=await createNativeLiveMacClaudeTransport(...args);Object.assign(value.runtime,{sessionMessagesImpl:async()=>[{}],importSessionToStoreImpl:async(_sid:string,store:any)=>store.append({sessionId:id(90)},transcript.map(r=>({...r}))),queryImpl:({prompt,options}:any)=>{taskAffordance=options.perTaskStopAffordance;
   launches++;void(async()=>{for await(const item of prompt)inputs.push(item);})();frames.push({type:"system",subtype:"init",session_id:id(90)});return {async getContextUsage(){if(!sampled){sampled=true;enteredReadback();await readbackReleased;}return {model:"claude-opus-5-5",totalTokens:100,maxTokens:1000,rawMaxTokens:1000,percentage:10,categories:[]};},[Symbol.asyncIterator]:()=>frames,close(){closes++;frames.end();inputs.end();}};
  }});return value;
 }});t.after(()=>runtime.closeAll());
 const command=(n:number,parent:string|null,wake=false)=>({protocol_version:4,dispatch_target:"claude_code",prepare_id:id(n),request_id:id(n+10),conversation_id:id(80),operation:wake?"wake":"send",runtime_mode:n===1?"new":"resume",canonical_user_message_id:wake?null:id(n+20),parent_provider_session_id:n===1?null:id(90),parent_provider_checkpoint_id:parent,expected_working_directory:null,prompt:"synthetic"} as NativeLiveRuntimeCommand);
 const finish=(uuid:string)=>{const cp=id(next++);transcript.push({type:"assistant",uuid:cp,parentUuid:transcript.at(-1)?.uuid??null,sessionId:id(90)});frames.push({type:"assistant",uuid:cp,session_id:id(90),message:{role:"assistant",content:[{type:"text",text:"synthetic"}]}});frames.push({type:"result",subtype:"success",session_id:id(90),user_message_uuid:uuid});return cp;};
 const run=(c:NativeLiveRuntimeCommand)=>runtime.executor.execute(c,{commit:result=>relay.submitResult({listenerInstanceId:id(91),reservationId:c.prepare_id,result})});
 const first=run(command(1,null));finish((await inputs.next()).value.uuid);await readbackEntered;
 const host=runtime.registry.get(id(80),runtime.registry.getGenerationId(id(80))!)!.session;
 const background=new Promise<void>(resolve=>host.events.once("background-result",()=>resolve()));finish(id(70));
 // The SDK advances again while foreground observability is still awaiting.
 releaseReadback();const firstRun=await first;assert.equal(firstRun.canonicalOutcome,"completed");assert.equal(firstRun.result.runtime_metadata?.context_usage?.total_tokens,100);await background;
 const submission=calls.find(c=>c.url.includes("background-results")&&c.url.endsWith("/result"));assert.equal(submission.body.result.prepare_id,id(1));assert.equal(submission.body.result.provider_checkpoint_id,id(101));
 quiet=true;const wake=run(command(2,id(101),true));finish((await inputs.next()).value.uuid);assert.equal((await wake).canonicalOutcome,"wake_quiet");
 quiet=false;const second=run(command(3,id(102)));const secondInput=(await inputs.next()).value;
  frames.push({type:"command_lifecycle",state:"started",command_uuid:secondInput.uuid,session_id:id(90)});
  finish(secondInput.uuid);assert.equal((await second).canonicalOutcome,"completed");
 assert.equal(launches,1);assert.equal(closes,0);assert.equal(taskAffordance,true);assert.equal((await runtime.backgroundResults.flush()),0);
 assert.ok(leaseTick,"idle writers require an ownership watchdog");leaseAlive=false;await (leaseTick as ()=>Promise<void>)();assert.equal(closes,1);assert.equal(runtime.registry.size,0);
});

test("restart fences conversations with pending background outbox before accepting a foreground send", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(),"persistent-outbox-recovery-")));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,"outbox"), outbox=new NativeLiveMacBackgroundResultOutbox(dir);
  const conversationId=id(80), receiptId=id(70);
  await outbox.save({
    sourcePrepareId:id(3),receiptId,listenerInstanceId:id(91),
    generationId:id(4),parentProviderCheckpointId:id(101),
    result:{
      protocol_version:4,prepare_id:id(3),request_id:id(13),
      conversation_id:conversationId,status:"success",
      provider_session_id:id(90),provider_checkpoint_id:id(102),
      effective_working_directory:root,
      normalized_events:[{type:"text",payload:{text:"recoverable background reply"}}],
    },
  });
  let available=false, firstAttempt!:()=>void;
  const firstAttemptSeen=new Promise<void>(resolve=>{firstAttempt=resolve;});
  const relay={
    async checkExecutionAdmission(){return true;}, async renewExecutionLease(){return true;},
    async renewSessionLease(){return true;},
    async prepareBackgroundResult(input:any){
      if(!available){firstAttempt();throw new Error("isolated relay temporarily offline");}
      return{receiptId:input.receiptId,providerSessionId:id(90),
        parentProviderCheckpointId:id(101),expiresAt:new Date(Date.now()+600000).toISOString()};
    },
    async submitBackgroundResult(input:any){
      return{outcome:"committed" as const,duplicate:false,providerCheckpointId:input.result.provider_checkpoint_id};
    },
  };
  const runtime=new NativeLiveMacPersistentRuntime({
    environment:{},defaultWorkingDirectory:root,listenerInstanceId:id(91),
    relay:relay as any,outboxDirectory:dir,attachmentMaterializer:null,outputAttachmentSender:null,
  });
  t.after(()=>runtime.closeAll());
  const command={
    protocol_version:4,dispatch_target:"claude_code",prepare_id:id(5),request_id:id(15),
    conversation_id:conversationId,operation:"send",runtime_mode:"new",
    canonical_user_message_id:id(25),parent_provider_session_id:null,parent_provider_checkpoint_id:null,
    expected_working_directory:null,prompt:"must not run until the outbox is replayed",
  } as NativeLiveRuntimeCommand;
  assert.equal(runtime.executor.canRoute(command),false,"crashed output must fence before any new dispatch");
  // Initial automatic attempt may have failed. A later bounded replay
  // commits the ORIGINAL receipt and clears recovery fencing.
  await firstAttemptSeen;
  available=true;
  assert.equal(await runtime.backgroundResults.flush(),1);
  for(let i=0;i<100 && !runtime.executor.canRoute(command);i++)await new Promise(setImmediate);
  assert.equal(runtime.executor.canRoute(command),true);
  assert.deepEqual(await outbox.list(),[]);
});
