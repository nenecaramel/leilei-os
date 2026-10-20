import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from '../src/database/client.js';
import { users, conversations, nativeLiveRuntimeListenerLeases as leases, nativeLiveTurnPreparations as preparations,
  nativeLiveProviderSessionCleanups as cleanups } from '../src/database/schema.js';
import { NativeLiveBackendTurnCoordinator } from '../src/domains/bridge/turn/native-live-backend-turn-coordinator.js';
import { DrizzleNativeLiveBackendTurnPort } from '../src/domains/bridge/turn/native-live-backend-turn-repository.js';
import { DrizzleNativeLiveBackendRelayRepository } from '../src/domains/bridge/relay/native-live-backend-relay.js';
import { DrizzleNativeLiveConversationRepository } from '../src/domains/conversation/native-live-conversation-repository.js';
import { bindNativeLiveInput, checkQueuedNativeLiveInput } from '../src/domains/bridge/relay/native-live-input-binding.js';
import { createTaskControl } from '../src/domains/bridge/runtime-interaction/native-live-task-control-repository.js';
import { NativeLiveManualCompactService } from '../src/domains/bridge/turn/native-live-manual-compact.js';
import { NativeLiveSilenceWakeService, silenceWakePreparationId } from '../src/domains/bridge/turn/native-live-silence-wake.js';
import { attachNativeContinuation, releaseNativeContinuation, readNativeContinuationState } from '../src/domains/conversation/native-session-continuation-repository.js';

import * as continuation from '../src/domains/conversation/native-session-continuation-repository.js';
import { syncNativeSessionOwner } from '../src/domains/bridge/turn/turn-repository/session-owner.js';
import { nativeLiveRuntimeEvents } from '../src/database/schema.js';

const enabled=process.env.RUN_NATIVE_SESSION_PRESERVATION_DATABASE_TEST==='1';
async function fixture(t:test.TestContext){
  const url=process.env.DATABASE_URL!;
  const {isolatedPostgresTarget,verifyIsolatedPostgresTarget}=await import('../scripts/isolated-postgres-target.mjs');
  await verifyIsolatedPostgresTarget(isolatedPostgresTarget(url));
  assert.equal(new URL(url).pathname,'/leileios_native_session_test');
  const database=createDatabase(url,{ssl:false}),db=database.db;
  const [user]=await db.insert(users).values({email:`owner-predicate-${randomUUID()}@example.com`,displayName:'Synthetic owner predicate'}).returning();
  t.after(async()=>{try{await db.delete(leases).where(eq(leases.userId,user.id));await db.delete(conversations).where(eq(conversations.userId,user.id));
    await db.delete(cleanups).where(eq(cleanups.userId,user.id));await db.delete(users).where(eq(users.id,user.id));}finally{await database.close();}});
  const canonical=new DrizzleNativeLiveConversationRepository(db),port=new DrizzleNativeLiveBackendTurnPort(db);
  const coordinator=new NativeLiveBackendTurnCoordinator(port),relay=new DrizzleNativeLiveBackendRelayRepository(db);
  const conversation=await canonical.createConversation({userId:user.id});
  const initial=await coordinator.prepare(user.id,{dispatch_target:'claude_code',request_id:randomUUID(),conversation_id:conversation.id,
    operation:'send',expected_head_message_id:null,text:'synthetic'});
  assert.ok(initial.ok);if(!initial.ok)throw Error('initial prepare');
  const listener=randomUUID(),session=randomUUID(),base=randomUUID(),later=new Date(Date.now()+600000);
  await db.insert(leases).values({userId:user.id,dispatchTarget:'claude_code',listenerInstanceId:listener,leaseExpiresAt:later});
  const execute=async(id:string)=>{await db.update(preparations).set({reservedBy:listener,reservedAt:new Date(),reservationExpiresAt:later,
    executionStartedAt:new Date(),dispatchStatus:'executing'}).where(eq(preparations.id,id));};
  await execute(initial.command.prepare_id);
  const completed=await coordinator.finalize(user.id,{protocol_version:4,prepare_id:initial.command.prepare_id,request_id:initial.command.request_id,
    conversation_id:conversation.id,status:'success',provider_session_id:session,provider_checkpoint_id:base,effective_working_directory:'/synthetic',
    normalized_events:[{type:'text',payload:{text:'synthetic reply'}}]});
  assert.ok(completed.ok&&completed.outcome==='completed');if(!completed.ok||completed.outcome!=='completed')throw Error('complete');
  await relay.markCompleted({userId:user.id,listenerInstanceId:listener,reservationId:initial.command.prepare_id});
  await db.execute(sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata,'{nativeSessionSource}','{"owner":"leileios"}'::jsonb)
    WHERE id=${conversation.id}::uuid`);
  const scope={userId:user.id,conversationId:conversation.id};
  const setOwner=async(owner:'desktop'|'releasing'|'leileios')=>{
    const rows=await db.execute(sql`UPDATE native_live_session_owners SET owner=${owner} WHERE user_id=${user.id}::uuid AND conversation_id=${conversation.id}::uuid RETURNING conversation_id`);
    assert.equal(rows.length,1);
    const [c]=await db.select().from(conversations).where(eq(conversations.id,conversation.id));
    assert.equal((c.providerMetadata.nativeSessionSource as {owner?:string}|undefined)?.owner,'leileios','JSON remains executable');
  };
  const send=()=>coordinator.prepare(user.id,{dispatch_target:'claude_code',request_id:randomUUID(),conversation_id:conversation.id,
    operation:'send',expected_head_message_id:completed.assistantMessageId,text:'synthetic next'});
  const admission=(c:typeof initial.command)=>({userId:user.id,listenerInstanceId:listener,reservationId:c.prepare_id,requestId:c.request_id,
    conversationId:c.conversation_id,runtimeMode:c.runtime_mode,canonicalUserMessageId:c.canonical_user_message_id,
    parentProviderSessionId:c.parent_provider_session_id,parentProviderCheckpointId:c.parent_provider_checkpoint_id!});
  const background={userId:user.id,sourcePrepareId:initial.command.prepare_id,listenerInstanceId:listener,generationId:randomUUID(),receiptId:randomUUID(),parentProviderCheckpointId:base};
  const backgroundResult={protocol_version:4 as const,prepare_id:initial.command.prepare_id,request_id:initial.command.request_id,
    conversation_id:conversation.id,status:'success' as const,provider_session_id:session,provider_checkpoint_id:randomUUID(),effective_working_directory:'/synthetic',
    normalized_events:[{type:'text' as const,payload:{text:'synthetic background'}}]};
  const wake=async()=>{
    let now=new Date();const service=new NativeLiveSilenceWakeService(db,()=>now);
    const schedule=await service.readSchedule({userId:user.id});assert.ok(schedule);now=new Date(schedule.postTurnDueAt);
    assert.equal((await service.fire({userId:user.id,epochId:schedule.epochId,slot:'post_turn_idle'})).outcome,'queued');
    const id=silenceWakePreparationId(schedule.epochId,'post_turn_idle');
    await db.update(preparations).set({runtimeMode:'resume'}).where(eq(preparations.id,id));await execute(id);
    const w=await port.getPreparation({userId:user.id,prepareId:id});assert.ok(w);
    return w;
  };
  return {db,user,scope,canonical,port,coordinator,relay,conversation,initial,completed,listener,session,base,execute,setOwner,send,admission,background,backgroundResult,wake};
}

async function releaseFixture(t:test.TestContext){
 const f=await fixture(t);
 const full={...f.scope,sessionId:f.session,checkpointId:f.base,revision:'1'.repeat(64),effectiveWorkingDirectory:'/synthetic',
  expectedHeadMessageId:f.completed.assistantMessageId,expectedRevision:null as string|null,checkpointIds:[f.base],completedTurnCheckpointIds:[f.base]};
 const beginInput={...f.scope,sessionId:f.session,expectedHeadMessageId:f.completed.assistantMessageId,expectedRevision:null as string|null};
 const begin=()=>continuation.beginNativeContinuationRelease(f.db,beginInput);
 return {...f,full,beginInput,begin};
}
test('begin is evidence-free, revision CAS/idempotent; complete requires R1 and preserves native validation',{skip:!enabled},async t=>{
 const f=await releaseFixture(t),r=await f.begin();assert.equal(r.owner,'releasing');assert.match(r.expectedRevision,/^[a-f0-9]{64}$/);
 assert.equal((await f.begin()).expectedRevision,r.expectedRevision);
 await assert.rejects(releaseNativeContinuation(f.db,f.full),{code:'STALE_NATIVE_PROJECTION'});
 await assert.rejects(releaseNativeContinuation(f.db,{...f.full,expectedRevision:r.expectedRevision,completedTurnCheckpointIds:[randomUUID()]}),{code:'INVALID_NATIVE_PROJECTION'});
 await releaseNativeContinuation(f.db,{...f.full,expectedRevision:r.expectedRevision});
 const completed=await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session});assert.equal(completed.owner,'desktop');
 await releaseNativeContinuation(f.db,{...f.full,expectedRevision:r.expectedRevision});
 assert.equal((await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session})).expectedRevision,completed.expectedRevision);
});
test('cancel rotates revision once, rejects stale CAS and restores a usable first send',{skip:!enabled},async t=>{
 const f=await releaseFixture(t),r=await f.begin(),input={...f.scope,expectedRevision:r.expectedRevision};
 await assert.rejects(continuation.cancelNativeContinuationRelease(f.db,{...input,expectedRevision:'f'.repeat(64)}),{code:'STALE_NATIVE_PROJECTION'});
 const c=await continuation.cancelNativeContinuationRelease(f.db,input);assert.equal(c.owner,'leileios');assert.notEqual(c.expectedRevision,r.expectedRevision);
 assert.equal((await continuation.cancelNativeContinuationRelease(f.db,input)).expectedRevision,c.expectedRevision);
 const p=await f.send();assert.ok(p.ok);if(!p.ok)throw Error('prepare');await f.execute(p.command.prepare_id);assert.equal(await f.relay.checkExecutionAdmission(f.admission(p.command)),true);
});
test('manual attach recovers a releasing owner with current evidence',{skip:!enabled},async t=>{
 const f=await releaseFixture(t),r=await f.begin();await attachNativeContinuation(f.db,{...f.full,expectedRevision:r.expectedRevision});assert.ok((await f.send()).ok);
});
for(const operation of ['send','edit','retry']as const)test(`begin fences ${operation} prepare with NATIVE_SESSION_SWITCHING`,{skip:!enabled},async t=>{
 const f=await releaseFixture(t);await f.begin();const r=await f.coordinator.prepare(f.user.id,{dispatch_target:'claude_code',request_id:randomUUID(),conversation_id:f.conversation.id,
 operation,...(operation==='send'?{text:'synthetic',expected_head_message_id:f.completed.assistantMessageId}:{target_user_message_id:f.initial.command.canonical_user_message_id!,...(operation==='edit'?{text:'synthetic edit'}:{})})});
 assert.equal(r.ok,false);if(!r.ok)assert.equal(r.code,'NATIVE_SESSION_SWITCHING');
});
for(const phase of ['prepared','queued','expired']as const)test(`${phase} background receipt ${phase==='expired'?'permits':'blocks'} begin`,{skip:!enabled},async t=>{
 const f=await releaseFixture(t);await f.relay.prepareBackgroundResult(f.background);
 if(phase!=='prepared')await f.db.execute(sql`UPDATE native_live_runtime_events SET payload=payload || ${JSON.stringify(phase==='queued'?{phase:'queued'}:{expiresAt:new Date(0).toISOString()})}::jsonb WHERE id=${f.background.receiptId}::uuid`);
 if(phase==='expired')assert.equal((await f.begin()).owner,'releasing');else await assert.rejects(f.begin(),{code:'NATIVE_CONVERSATION_BUSY'});
});
test('in-flight turn blocks begin before changing owner',{skip:!enabled},async t=>{
 const f=await releaseFixture(t);assert.ok((await f.send()).ok);await assert.rejects(f.begin(),{code:'NATIVE_CONVERSATION_BUSY'});
 assert.equal((await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session})).owner,'leileios');
});
test('releasing is mirrored as releasing without overwriting slot or generation',{skip:!enabled},async t=>{
 const f=await releaseFixture(t);const read=()=>f.db.execute(sql`SELECT turn_prepare_id,turn_anchor_message_id,writer_generation FROM native_live_session_owners WHERE conversation_id=${f.conversation.id}::uuid`);
 const before=await read();await f.db.execute(sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata,'{nativeSessionSource,owner}','"releasing"'::jsonb) WHERE id=${f.conversation.id}::uuid`);
 await syncNativeSessionOwner(f.db,f.scope);const [owner]=await f.db.execute(sql`SELECT owner FROM native_live_session_owners WHERE conversation_id=${f.conversation.id}::uuid`);
 assert.equal(owner.owner,'releasing');assert.deepEqual(await read(),before);
});
test('begin validates session/head/revision and isolates user before mutations',{skip:!enabled},async t=>{
 const f=await releaseFixture(t);
 for(const [patch,code] of [[{userId:randomUUID()},'NATIVE_CONVERSATION_NOT_FOUND'],[{expectedHeadMessageId:randomUUID()},'STALE_NATIVE_PROJECTION'],[{expectedRevision:'f'.repeat(64)},'STALE_NATIVE_PROJECTION'],[{sessionId:randomUUID()},'EXPLICIT_BRANCH_SELECTION_REQUIRED']] as const)
  await assert.rejects(continuation.beginNativeContinuationRelease(f.db,{...f.beginInput,...patch}),{code});
 assert.equal((await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session})).owner,'leileios');
});
test('legacy release stays usable for one release',{skip:!enabled},async t=>{
 const f=await releaseFixture(t);await releaseNativeContinuation(f.db,f.full);assert.equal((await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session})).owner,'desktop');
});
// These represent late old callbacks after begin. Begin itself correctly refuses
// live work; restoring only the old transport lease tests each independent fence.
for(const action of ['admit','renew','queued','started','background prepare','background submit','Wake','task control','compact','legacy release']as const)
test(`releasing API owner fences late ${action}`,{skip:!enabled},async t=>{
 const f=await releaseFixture(t);
 let input:ReturnType<typeof f.admission>|undefined;
 if(['admit','renew','queued','started'].includes(action)){
  const p=await f.send();assert.ok(p.ok);if(!p.ok)throw Error('prepare');await f.execute(p.command.prepare_id);input=f.admission(p.command);
  assert.equal(await f.relay.checkExecutionAdmission(input),true);
  await f.relay.rejectReservation({userId:f.user.id,listenerInstanceId:f.listener,reservationId:p.command.prepare_id,code:'INVALID_COMMAND'});
 }
 if(action==='background submit'){
  await f.relay.prepareBackgroundResult(f.background);await f.db.execute(sql`UPDATE native_live_runtime_events SET payload=jsonb_set(payload,'{expiresAt}',${JSON.stringify(new Date(0).toISOString())}::jsonb) WHERE id=${f.background.receiptId}::uuid`);
 }
 await f.begin();
 if(input)await f.execute(input.reservationId);
 if(action==='admit')assert.equal(await f.relay.checkExecutionAdmission(input!),false);
 if(action==='renew')assert.equal(await f.relay.renewExecutionLease(input!),false);
 if(action==='queued'||action==='started')assert.equal(await bindNativeLiveInput(f.db,{...input!,phase:action}),null);
 if(action==='background prepare')await assert.rejects(f.relay.prepareBackgroundResult(f.background),{code:'BACKGROUND_CONFLICT'});
 if(action==='background submit'){
  await f.db.execute(sql`UPDATE native_live_runtime_events SET payload=jsonb_set(payload,'{expiresAt}',${JSON.stringify(new Date(Date.now()+600000).toISOString())}::jsonb) WHERE id=${f.background.receiptId}::uuid`);
  assert.equal((await f.relay.submitBackgroundResult({...f.background,result:f.backgroundResult})).outcome,'stale');
 }
 if(action==='Wake'){
  let now=new Date();const service=new NativeLiveSilenceWakeService(f.db,()=>now),schedule=await service.readSchedule({userId:f.user.id});assert.ok(schedule);now=new Date(schedule.postTurnDueAt);
  assert.deepEqual(await service.fire({userId:f.user.id,epochId:schedule.epochId,slot:'post_turn_idle'}),{outcome:'ignored',reason:'source_changed',schedule:null});
 }
 if(action==='task control')await assert.rejects(createTaskControl(f.db,{userId:f.user.id,prepareId:f.initial.command.prepare_id,controlId:randomUUID(),payload:{action:'list'}}),{code:'TURN_NOT_ACTIVE'});
 if(action==='compact')await assert.rejects(new NativeLiveManualCompactService(f.db,undefined,{isListenerOnline:async()=>true}).create(f.scope),{code:'CONVERSATION_BUSY'});
 if(action==='legacy release'){
  const {releaseNativeSessionToDesktop}=await import('../src/domains/conversation/native-session-history-repository.js');
  const r=await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session});
  await assert.rejects(releaseNativeSessionToDesktop(f.db,{...f.scope,sessionId:f.session,expectedHeadMessageId:f.completed.assistantMessageId,expectedCheckpointId:f.base,expectedRevision:r.expectedRevision!}),{code:'NATIVE_SESSION_SWITCHING'});
 }
});

test('releasing send/edit/retry are HTTP 409 and never enqueue',{skip:!enabled},async t=>{
 const f=await releaseFixture(t);await f.begin();
 const {withServer}=await import('./helpers/native-live-http-relay-fixtures.js');
 const {prepareNativeLiveTurnHandler}=await import('../src/web-api/native-live/turns.js');
 await withServer(app=>{app.use((req,_res,next)=>{req.webUserId=f.user.id;next();});app.post('/prepare',prepareNativeLiveTurnHandler({coordinator:f.coordinator,
  relayService:{enqueuePreparation:async()=>{throw Error('must not enqueue');}}} as any));},async base=>{
  for(const operation of ['send','edit','retry']){
   const body={dispatch_target:'claude_code',request_id:randomUUID(),conversation_id:f.conversation.id,operation,
    ...(operation==='send'?{text:'synthetic',expected_head_message_id:f.completed.assistantMessageId}:{target_user_message_id:f.initial.command.canonical_user_message_id,...(operation==='edit'?{text:'synthetic'}:{})})};
   const r=await fetch(base+'/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
   assert.equal(r.status,409);assert.equal((await r.json() as any).error.code,'NATIVE_SESSION_SWITCHING');
  }
 });
});
test('begin and cancel HTTP endpoints enforce auth, shape, CAS and return the row revision',{skip:!enabled},async t=>{
 const f=await releaseFixture(t);const {withServer}=await import('./helpers/native-live-http-relay-fixtures.js');
 const {createNativeLiveProviderSessionStoreInternalRouter}=await import('../src/web-api/native-live-provider-session-store-internal-router.js');
 await withServer(app=>{app.use((req,_res,next)=>{if(req.headers['x-test-auth']==='yes')req.mcpUserId=f.user.id;next();});app.use('/store',createNativeLiveProviderSessionStoreInternalRouter({
  beginNativeContinuationRelease:input=>continuation.beginNativeContinuationRelease(f.db,input),cancelNativeContinuationRelease:input=>continuation.cancelNativeContinuationRelease(f.db,input),
  providerSessionStoreService:{} as any}));},async base=>{
  const post=(op:string,body:unknown,auth=true)=>fetch(base+'/store/native-history/continuation-release-'+op,{method:'POST',headers:{'content-type':'application/json',...(auth?{'x-test-auth':'yes'}:{})},body:JSON.stringify(body)});
  const {userId,...body}=f.beginInput;
  assert.equal((await post('begin',body,false)).status,401);assert.equal((await post('begin',{...body,extra:true})).status,400);
  const r=await post('begin',body);assert.equal(r.status,200);const data=(await r.json() as any).data;assert.equal(data.owner,'releasing');
  const bad=await post('cancel',{conversationId:f.conversation.id,expectedRevision:'f'.repeat(64)});assert.equal(bad.status,409);
  const c=await post('cancel',{conversationId:f.conversation.id,expectedRevision:data.expectedRevision});assert.equal(c.status,200);assert.equal((await c.json() as any).data.owner,'leileios');
 });
});
for(const action of ['asset','restore']as const)test(`releasing refuses the legacy ${action} API before its compatibility path`,{skip:!enabled},async t=>{
 const f=await releaseFixture(t),sessionId=randomUUID(),u=randomUUID(),a=randomUUID(),conversationId=randomUUID(),revision='2'.repeat(64);
 const {projectNativeHistory}=await import('../tools/claude-bridge/src/native-session-history.mjs');
 const {restoreNativeSessionHistory}=await import('../src/domains/conversation/native-session-history-repository.js');
 const {nativeSessionAsset}=await import('../src/domains/conversation/native-session-asset-repository.js');
 const entries=[{uuid:u,parentUuid:null,type:'user',timestamp:'2026-10-20T00:00:00Z',message:{content:[{type:'image',source:{type:'base64',media_type:'image/png',data:Buffer.from('synthetic').toString('base64')}}]}},
  {uuid:a,parentUuid:u,type:'assistant',timestamp:'2026-10-20T00:00:01Z',message:{content:[{type:'text',text:'synthetic'}]}}];
 const input={userId:f.user.id,conversationId,expectedHeadMessageId:null,expectedRevision:null,effectiveWorkingDirectory:'/synthetic',projection:projectNativeHistory({sessionId,revision,entries},a),nativeSnapshot:{sessionId,revision,entries}};
 const restored=await restoreNativeSessionHistory(f.db,input);const state=await readNativeContinuationState(f.db,{userId:f.user.id,conversationId,sessionId});
 const release=await continuation.beginNativeContinuationRelease(f.db,{userId:f.user.id,conversationId,sessionId,expectedHeadMessageId:restored.headMessageId,expectedRevision:state.expectedRevision});
 if(action==='asset')await assert.rejects(nativeSessionAsset(f.db,{userId:f.user.id,conversationId,sessionId,expectedRevision:release.expectedRevision,sourceEntryUuid:u,sourceBlockOrdinal:0}),{code:'NATIVE_CONVERSATION_BUSY'});
 else await assert.rejects(restoreNativeSessionHistory(f.db,{...input,expectedHeadMessageId:restored.headMessageId,expectedRevision:state.expectedRevision}),{code:'NATIVE_SESSION_SWITCHING'});
});

for(const atAnchor of [false,true])for(const finish of ['complete','cancel']as const)test(`verified quiet cursor survives begin then ${finish}, at handoff anchor=${atAnchor}`,{skip:!enabled},async t=>{
 const f=await releaseFixture(t);
 if(atAnchor)await attachNativeContinuation(f.db,f.full);
 f.beginInput.expectedRevision=(await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session})).expectedRevision;
 const w=await f.wake(),q=randomUUID();const final=await f.coordinator.finalize(f.user.id,{...f.backgroundResult,prepare_id:w.prepareId,request_id:w.requestId,
  provider_checkpoint_id:q,normalized_events:[{type:'text',payload:{text:'<quiet />'}}]});assert.ok(final.ok&&final.outcome==='wake_quiet');
 await f.relay.markCompleted({userId:f.user.id,listenerInstanceId:f.listener,reservationId:w.prepareId});
 assert.equal((await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session})).providerCheckpointId,q);
 const r=await f.begin();assert.equal((await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session})).providerCheckpointId,q);
 if(finish==='complete')await releaseNativeContinuation(f.db,{...f.full,expectedRevision:r.expectedRevision,checkpointId:q,checkpointIds:[q,f.base],completedTurnCheckpointIds:[q]});
 else{await continuation.cancelNativeContinuationRelease(f.db,{...f.scope,expectedRevision:r.expectedRevision});
  const p=await f.send();assert.ok(p.ok);if(p.ok)assert.equal(p.command.parent_provider_checkpoint_id,q);}
});
for(const stale of ['generation','revision']as const)test(`begin/cancel does not rebind a stale ${stale} quiet cursor`,{skip:!enabled},async t=>{
 const f=await releaseFixture(t),q=randomUUID();
 const tail={canonical_message_id:f.completed.assistantMessageId,provider_session_id:f.session,base_checkpoint_id:f.base,checkpoint_id:q,cwd:'/synthetic',
  presentation_owner_id:f.initial.command.prepare_id,writer_generation:stale==='generation'?randomUUID():null,source_revision:stale==='revision'?'f'.repeat(64):null};
 if(stale==='revision'){const [g]=await f.db.execute<{generation:string}>(sql`SELECT writer_generation::text AS generation FROM native_live_session_owners WHERE conversation_id=${f.conversation.id}::uuid`);tail.writer_generation=g.generation;}
 await f.db.execute(sql`UPDATE conversation_provider_session_checkpoints SET runtime_metadata=jsonb_set(runtime_metadata,'{native_live_resume_tail}',${JSON.stringify(tail)}::jsonb) WHERE canonical_message_id=${f.completed.assistantMessageId}::uuid`);
 const r=await f.begin();await continuation.cancelNativeContinuationRelease(f.db,{...f.scope,expectedRevision:r.expectedRevision});
 const [after]=await f.db.execute<{tail:unknown}>(sql`SELECT runtime_metadata->'native_live_resume_tail' AS tail FROM conversation_provider_session_checkpoints WHERE canonical_message_id=${f.completed.assistantMessageId}::uuid`);
 assert.deepEqual(after.tail,tail);const p=await f.send();assert.ok(p.ok);if(p.ok)assert.equal(p.command.parent_provider_checkpoint_id,f.base);
});

test('concurrent duplicate begin/cancel rotate once and leave turn/generation intact',{skip:!enabled},async t=>{
 const f=await releaseFixture(t),read=()=>f.db.execute(sql`SELECT turn_prepare_id,turn_anchor_message_id,writer_generation FROM native_live_session_owners WHERE conversation_id=${f.conversation.id}::uuid`);
 const before=await read();const [a,b]=await Promise.all([f.begin(),f.begin()]);assert.equal(a.expectedRevision,b.expectedRevision);
 const input={...f.scope,expectedRevision:a.expectedRevision};const [c,d]=await Promise.all([continuation.cancelNativeContinuationRelease(f.db,input),continuation.cancelNativeContinuationRelease(f.db,input)]);
 assert.equal(c.expectedRevision,d.expectedRevision);assert.notEqual(c.expectedRevision,a.expectedRevision);assert.deepEqual(await read(),before);
 await assert.rejects(continuation.cancelNativeContinuationRelease(f.db,{...f.scope,expectedRevision:c.expectedRevision}),{code:'STALE_NATIVE_PROJECTION'});
});
test('legacy complete also refuses a queued background receipt',{skip:!enabled},async t=>{
 const f=await releaseFixture(t);await f.relay.prepareBackgroundResult(f.background);
 await f.db.execute(sql`UPDATE native_live_runtime_events SET payload=jsonb_set(payload,'{phase}','"queued"'::jsonb) WHERE id=${f.background.receiptId}::uuid`);
 await assert.rejects(releaseNativeContinuation(f.db,f.full),{code:'NATIVE_CONVERSATION_BUSY'});
});

test('Wake firing during releasing cannot create a BUSY preparation or strand release retries',{skip:!enabled},async t=>{
 const f=await releaseFixture(t),r=await f.begin();let now=new Date();const service=new NativeLiveSilenceWakeService(f.db,()=>now);
 const schedule=await service.readSchedule({userId:f.user.id});assert.ok(schedule);now=new Date(schedule.postTurnDueAt);
 const before=await f.db.select({id:preparations.id}).from(preparations).where(eq(preparations.conversationId,f.conversation.id));
 assert.deepEqual(await service.fire({userId:f.user.id,epochId:schedule.epochId,slot:'post_turn_idle'}),{outcome:'ignored',reason:'source_changed',schedule:null});
 assert.deepEqual(await f.db.select({id:preparations.id}).from(preparations).where(eq(preparations.conversationId,f.conversation.id)),before);
 assert.equal((await f.begin()).expectedRevision,r.expectedRevision);
 await releaseNativeContinuation(f.db,{...f.full,expectedRevision:r.expectedRevision});
 assert.equal((await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session})).owner,'desktop');
});
