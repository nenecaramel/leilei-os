import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../src/database/client.js';
import { users, conversations, conversationMessages, conversationProviderSessionCheckpoints, nativeLiveRuntimeListenerLeases } from '../src/database/schema.js';
import { NativeLiveBackendTurnCoordinator } from '../src/domains/bridge/turn/native-live-backend-turn-coordinator.js';
import { DrizzleNativeLiveBackendTurnPort } from '../src/domains/bridge/turn/native-live-backend-turn-repository.js';
import { DrizzleNativeLiveBackendRelayRepository, NativeLiveBackendRelayService } from '../src/domains/bridge/relay/native-live-backend-relay.js';
import { NativeLiveMacDaemonLoop } from '../src/domains/bridge/mac/native-live-mac-daemon-loop.js';
import { NativeLiveMacResultOutbox } from '../src/domains/bridge/mac/native-live-mac-result-outbox.js';
import { NativeLiveMacPersistentExecutor } from '../src/domains/bridge/mac/native-live-mac-persistent-executor.js';
import { NativeLiveMacPersistentTurnRouter } from '../src/domains/bridge/mac/native-live-mac-persistent-turn-router.js';
import { NativeLiveMacSessionRegistry } from '../src/domains/bridge/mac/native-live-mac-session-registry.js';
import { createNativeLiveMacClaudeTransport } from '../src/domains/bridge/mac/native-live-mac-claude-transport.js';
import type { NativeLiveRuntimeCommand } from '../src/domains/bridge/protocol/native-live-runtime-protocol.js';
function queue<T>(){const values:T[]=[];let ended=false,wait:((r:IteratorResult<T>)=>void)|undefined;return{
 push(v:T){if(wait){const w=wait;wait=undefined;w({value:v,done:false});}else values.push(v);},end(){ended=true;wait?.({value:undefined,done:true});},
 [Symbol.asyncIterator](){return this;},next():Promise<IteratorResult<T>>{if(values.length)return Promise.resolve({value:values.shift()!,done:false});if(ended)return Promise.resolve({value:undefined,done:true});return new Promise(r=>{wait=r;});}};}
const enabled=process.env.RUN_NATIVE_LIVE_RELAY_DATABASE_TEST==='1';
for (const withSnapshot of [false, true]) test(`closed SDK complete native reply survives lost canonical ACK and admits next turn without duplicate execution (prompt snapshot: ${withSnapshot})`, {skip:!enabled},async t=>{
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/leileios_native_session_test');assert.notEqual(process.env.NODE_ENV,'production');
 const root=await realpath(await mkdtemp(join(tmpdir(),'native-complete-delivery-'))),database=createDatabase(url.href,{ssl:false});
 const [user]=await database.db.insert(users).values({email:`complete-${randomUUID()}@example.com`,displayName:'Synthetic completed delivery'}).returning();
 const conversationId=randomUUID(),listener=randomUUID(),sid=randomUUID(),checkpoint=randomUUID(),filename=join(root,'synthetic.jsonl');
 await database.db.insert(conversations).values({id:conversationId,userId:user!.id,origin:'native_live',lifecycleStatus:'active',providerMetadata:{}});
 const coordinator=new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
 const service=new NativeLiveBackendRelayService(new DrizzleNativeLiveBackendRelayRepository(database.db),coordinator);
 const prepared=await coordinator.prepare(user!.id,{dispatch_target:'claude_code',request_id:randomUUID(),operation:'send',conversation_id:conversationId,expected_head_message_id:null,text:'synthetic input'});
 assert.ok(prepared.ok);if(!prepared.ok)throw Error('prepare');await service.enqueuePreparation({userId:user!.id,prepareId:prepared.command.prepare_id});
 const output=queue<Record<string,unknown>>(),inputs=queue<{uuid:string}>();let launches=0,router!:NativeLiveMacPersistentTurnRouter,lose=true;
 const registry=new NativeLiveMacSessionRegistry({},root,async(...args)=>{
  const transport=await createNativeLiveMacClaudeTransport(...args);
  Object.assign(transport.runtime,{sessionMessagesImpl:async()=>[{}],importSessionToStoreImpl:async(_sid:string,store:any)=>{const lines=(await readFile(filename,'utf8')).trim().split('\n').map(line=>JSON.parse(line));await store.append({sessionId:sid},lines);},queryImpl:({prompt}:any)=>{
   launches++;void(async()=>{for await(const input of prompt)inputs.push(input);})();output.push({type:'system',subtype:'init',session_id:sid});
   return {[Symbol.asyncIterator]:()=>output,close(){output.end();inputs.end();}};
  }});return transport;
 });
 const admission=(value:{listenerInstanceId:string;command:NativeLiveRuntimeCommand})=>({userId:user!.id,listenerInstanceId:value.listenerInstanceId,reservationId:value.command.prepare_id,requestId:value.command.request_id,
  conversationId:value.command.conversation_id,runtimeMode:value.command.runtime_mode,canonicalUserMessageId:value.command.canonical_user_message_id,
  parentProviderSessionId:value.command.parent_provider_session_id,parentProviderCheckpointId:value.command.parent_provider_checkpoint_id??null});
 const events:string[]=[];const outbox=new NativeLiveMacResultOutbox(join(root,'result'));
 const client:any={renewLease:(input:any)=>service.renewLease({userId:user!.id,...input}),reserveNext:(input:any)=>service.reserveNext({userId:user!.id,...input}),markExecutionStarted:(input:any)=>service.markExecutionStarted({userId:user!.id,...input}),
  checkExecutionAdmission:(input:any)=>service.checkExecutionAdmission(admission(input)),markResultDeliveryUnknown:(input:any)=>service.markResultDeliveryUnknown({userId:user!.id,...input}),
  async submitResult(input:any){assert.equal((await outbox.list()).length,1);assert.equal(input.result.status,'success');assert.equal(input.result.provider_checkpoint_id,checkpoint);
   const result=await service.submitResult({userId:user!.id,...input});assert.ok(result.ok);if(!result.ok)throw Error(result.code);events.push(result.outcome);if(lose)throw Error('synthetic ACK lost after commit');return {canonicalOutcome:result.outcome};},
 };
 const executor=new NativeLiveMacPersistentExecutor({attachmentMaterializer:null,outputAttachmentSender:null,hasCapacity:()=>registry.size<4,createRouter(){return router=new NativeLiveMacPersistentTurnRouter({registry,listenerInstanceId:listener,relay:client,async onBackgroundResult(){throw Error('no autonomous work');}});}});
 t.after(async()=>{await executor.closeAll();await registry.closeAll();try{await database.db.delete(nativeLiveRuntimeListenerLeases).where(eq(nativeLiveRuntimeListenerLeases.userId,user!.id));await database.db.delete(conversations).where(eq(conversations.userId,user!.id));await database.db.delete(users).where(eq(users.id,user!.id));}finally{await database.close();await rm(root,{recursive:true,force:true});}});
 const loop=new NativeLiveMacDaemonLoop(listener,client,{async execute(){throw Error('no one-shot/model replay');}},null,null,null,null,null,null,outbox,executor);
 const pending=loop.runOnce(),input=(await inputs.next()).value!;
 const native:Array<Record<string,unknown>>=[{type:'user',uuid:input.uuid,parentUuid:null,sessionId:sid,message:{role:'user',content:'synthetic input'}},{type:'assistant',uuid:checkpoint,parentUuid:input.uuid,sessionId:sid,message:{role:'assistant',content:[{type:'text',text:'synthetic complete reply'}],stop_reason:'end_turn'}}];
 const snapshot=randomUUID();
 if(withSnapshot)native.push({type:'attachment',uuid:snapshot,parentUuid:checkpoint,sessionId:sid,attachment:{type:'prompt_snapshot',systemPrompt:'synthetic metadata'}},{type:'system',subtype:'stop_hook_summary',uuid:randomUUID(),parentUuid:snapshot,sessionId:sid,preventedContinuation:false,hookErrors:[]});
 await writeFile(filename,native.map(e=>JSON.stringify(e)).join('\n')+'\n');const original=await readFile(filename,'utf8');
 await router.close('CONTROL_RECEIPT_TIMEOUT');assert.equal((await pending).outcome,'delivery_unknown');assert.equal((await outbox.list()).length,1);assert.equal(launches,1);
 lose=false;assert.equal((await loop.runOnce()).outcome,'completed');assert.equal(launches,1);assert.deepEqual(events,['completed','idempotent']);assert.deepEqual(await outbox.list(),[]);assert.equal(await readFile(filename,'utf8'),original);
 const messages=await database.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId,conversationId));const assistants=messages.filter(m=>m.role==='assistant');assert.equal(assistants.length,1);
 const checkpoints=await database.db.select().from(conversationProviderSessionCheckpoints).where(eq(conversationProviderSessionCheckpoints.conversationId,conversationId));assert.equal(checkpoints.length,1);assert.equal(checkpoints[0]!.providerCheckpointId,checkpoint);
 const next=await coordinator.prepare(user!.id,{dispatch_target:'claude_code',request_id:randomUUID(),operation:'send',conversation_id:conversationId,expected_head_message_id:assistants[0]!.id,text:'synthetic next input'});
 assert.ok(next.ok);if(next.ok){assert.equal(next.command.parent_provider_session_id,sid);assert.equal(next.command.parent_provider_checkpoint_id,checkpoint);assert.equal(executor.canRoute(next.command),true);}
});
