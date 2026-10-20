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

// Deliberately disagreeing sources catch accidental fallback to the retired JSON.
async function slot(f:Awaited<ReturnType<typeof fixture>>){
  const [r]=await f.db.execute<{prepare:string|null;anchor:string|null}>(sql`SELECT turn_prepare_id::text AS prepare,
    turn_anchor_message_id::text AS anchor FROM native_live_session_owners WHERE user_id=${f.user.id}::uuid AND conversation_id=${f.conversation.id}::uuid`);
  return r;
}
async function corrupt(f:Awaited<ReturnType<typeof fixture>>,source:'json'|'row',field:'prepare'|'anchor'='prepare'){
  const good=await slot(f);assert.ok(good);
  // Seed an exact stale JSON copy even after prepare stops writing it.
  const json={prepareId:good.prepare,anchorHeadMessageId:good.anchor};
  const wrong=randomUUID();
  if(source==='json'){if(field==='prepare')json.prepareId=wrong;else json.anchorHeadMessageId=wrong;}
  await f.db.execute(sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata,'{native_live_presentation_owner}',${JSON.stringify(json)}::jsonb) WHERE id=${f.conversation.id}::uuid`);
  if(source==='row')await f.db.execute(field==='prepare'
    ?sql`UPDATE native_live_session_owners SET turn_prepare_id=${wrong}::uuid WHERE conversation_id=${f.conversation.id}::uuid`
    :sql`UPDATE native_live_session_owners SET turn_anchor_message_id=${wrong}::uuid WHERE conversation_id=${f.conversation.id}::uuid`);
  return wrong;
}
for(const source of ['json','row']as const){
 for(const operation of ['send','edit','retry']as const)test(`${source} slot disagrees: ${operation} admission and renewal use the row`,{skip:!enabled},async t=>{
  const f=await fixture(t);const p=operation==='send'?await f.send():await f.coordinator.prepare(f.user.id,{dispatch_target:'claude_code',request_id:randomUUID(),
    conversation_id:f.conversation.id,operation,target_user_message_id:f.initial.command.canonical_user_message_id!,...(operation==='edit'?{text:'synthetic edit'}:{})});
  assert.ok(p.ok);if(!p.ok)throw Error('prepare');await f.execute(p.command.prepare_id);await corrupt(f,source);
  const input=f.admission(p.command);assert.equal(await f.relay.checkExecutionAdmission(input),source==='json');assert.equal(await f.relay.renewExecutionLease(input),source==='json');
 });
 for(const phase of ['queued','started']as const)test(`${source} slot disagrees: input ${phase} uses the row`,{skip:!enabled},async t=>{
  const f=await fixture(t),p=await f.send();assert.ok(p.ok);if(!p.ok)throw Error('prepare');await f.execute(p.command.prepare_id);const input=f.admission(p.command);
  if(phase==='started')assert.ok(await bindNativeLiveInput(f.db,{...input,phase:'queued'}));
  await corrupt(f,source);assert.equal(Boolean(await bindNativeLiveInput(f.db,{...input,phase})),source==='json');
 });
 test(`${source} slot disagrees: replacement finalize and anchor use the row`,{skip:!enabled},async t=>{
  const f=await fixture(t),p=await f.coordinator.prepare(f.user.id,{dispatch_target:'claude_code',request_id:randomUUID(),conversation_id:f.conversation.id,
    operation:'retry',target_user_message_id:f.initial.command.canonical_user_message_id!});assert.ok(p.ok);if(!p.ok)throw Error('prepare');
  await f.execute(p.command.prepare_id);await corrupt(f,source);
  const r=await f.coordinator.finalize(f.user.id,{...f.backgroundResult,prepare_id:p.command.prepare_id,request_id:p.command.request_id,provider_session_id:randomUUID()});
  if(source==='json'){assert.ok(r.ok&&r.outcome==='completed');if(r.ok&&r.outcome==='completed')assert.deepEqual(await slot(f),{prepare:p.command.prepare_id,anchor:r.assistantMessageId});}
  else{assert.equal(r.ok,false);assert.equal((await f.canonical.getConversation(f.scope))!.currentHeadMessageId,f.completed.assistantMessageId);}
 });
 test(`${source} anchor disagrees: background snapshot and append use the row`,{skip:!enabled},async t=>{
  const f=await fixture(t);await corrupt(f,source,'anchor');
  const prepared=await f.relay.prepareBackgroundResult(f.background);
  assert.ok(prepared);
  if(source==='row')await assert.rejects(f.relay.submitBackgroundResult({...f.background,result:f.backgroundResult}),{code:'BACKGROUND_CONFLICT'});
  else assert.equal((await f.relay.submitBackgroundResult({...f.background,result:f.backgroundResult})).outcome,'committed');
  assert.equal((await f.canonical.getConversation(f.scope))!.currentHeadMessageId,source==='json'?f.background.receiptId:f.completed.assistantMessageId);
  if(source==='json')assert.deepEqual(await slot(f),{prepare:f.initial.command.prepare_id,anchor:f.background.receiptId});
 });
 test(`${source} slot disagrees: background pending-owner snapshot uses the row`,{skip:!enabled},async t=>{
  const f=await fixture(t),p=await f.send();assert.ok(p.ok);if(!p.ok)throw Error('prepare');await f.execute(p.command.prepare_id);
  assert.ok(await bindNativeLiveInput(f.db,{...f.admission(p.command),phase:'queued'}));await corrupt(f,source);
  if(source==='row')await assert.rejects(f.relay.prepareBackgroundResult({...f.background,executionStart:true,deferred:true}),{code:'BACKGROUND_CONFLICT'});
  else{await f.relay.prepareBackgroundResult({...f.background,executionStart:true,deferred:true});
    const [r]=await f.db.execute<{slot:string}>(sql`SELECT payload->'context'->>'presentationOwnerId' AS slot FROM native_live_runtime_events WHERE id=${f.background.receiptId}::uuid`);
    assert.equal(r.slot,p.command.prepare_id);}
 });
 test(`${source} slot disagrees: silence Wake stamps the row slot`,{skip:!enabled},async t=>{
  const f=await fixture(t),wrong=await corrupt(f,source),w=await f.wake();
  assert.equal((w.wakeContext?.runtime_generation as {presentation_owner_id:string}).presentation_owner_id,
    source==='json'?f.initial.command.prepare_id:wrong);
 });
 test(`${source} slot disagrees: quiet Wake retargets only the queued row owner`,{skip:!enabled},async t=>{
  const f=await fixture(t),w=await f.wake(),p=await f.send();assert.ok(p.ok);if(!p.ok)throw Error('prepare');await corrupt(f,source);
  const next=randomUUID(),r=await f.coordinator.finalize(f.user.id,{...f.backgroundResult,prepare_id:w.prepareId,request_id:w.requestId,
    provider_checkpoint_id:next,normalized_events:[{type:'text',payload:{text:'<quiet />'}}]});
  assert.ok(r.ok&&r.outcome==='wake_stale');
  const stored=await f.port.getPreparation({userId:f.user.id,prepareId:p.command.prepare_id});
  assert.equal(stored!.parentProviderCheckpointId,source==='json'?next:f.base);
 });
 for(const quiet of [false,true])test(`${source} slot disagrees: ${quiet?'quiet':'visible'} Wake uses the row`,{skip:!enabled},async t=>{
  const f=await fixture(t),w=await f.wake();await corrupt(f,source,quiet?'prepare':'anchor');
  const r=await f.coordinator.finalize(f.user.id,{...f.backgroundResult,prepare_id:w.prepareId,request_id:w.requestId,
    normalized_events:[{type:'text',payload:{text:quiet?'<quiet />':'synthetic visible Wake'}}]});
  assert.ok(r.ok);if(!r.ok)throw Error(r.code);
  assert.equal(r.outcome,source==='row'?'wake_stale':quiet?'wake_quiet':'completed');
  if(source==='json'&&!quiet&&r.outcome==='completed')assert.deepEqual(await slot(f),{prepare:f.initial.command.prepare_id,anchor:r.assistantMessageId});
 });
}
test('prepare strips stale JSON, replaces the row turn and captures the head without rotating generation',{skip:!enabled},async t=>{
 const f=await fixture(t);await corrupt(f,'json');
 const [before]=await f.db.execute(sql`SELECT writer_generation FROM native_live_session_owners WHERE conversation_id=${f.conversation.id}::uuid`);
 const p=await f.send();assert.ok(p.ok);if(!p.ok)throw Error('prepare');
 const [c]=await f.db.select().from(conversations).where(eq(conversations.id,f.conversation.id));assert.equal(Object.hasOwn(c.providerMetadata,'native_live_presentation_owner'),false);
 assert.deepEqual(await slot(f),{prepare:p.command.prepare_id,anchor:f.completed.assistantMessageId});
 const [after]=await f.db.execute(sql`SELECT writer_generation FROM native_live_session_owners WHERE conversation_id=${f.conversation.id}::uuid`);assert.deepEqual(after,before);
});
for(const missing of ['row','turn']as const)test(`failure with no ${missing} keeps failed-turn recovery compatibility`,{skip:!enabled},async t=>{
 const f=await fixture(t),p=await f.send();assert.ok(p.ok);if(!p.ok)throw Error('prepare');await f.execute(p.command.prepare_id);
 assert.ok(await bindNativeLiveInput(f.db,{...f.admission(p.command),phase:'queued'}));
 assert.ok(await bindNativeLiveInput(f.db,{...f.admission(p.command),phase:'started'}));
 await corrupt(f,'json');
 if(missing==='row')await f.db.execute(sql`DELETE FROM native_live_session_owners WHERE conversation_id=${f.conversation.id}::uuid`);
 else await f.db.execute(sql`UPDATE native_live_session_owners SET turn_prepare_id=NULL,turn_anchor_message_id=NULL WHERE conversation_id=${f.conversation.id}::uuid`);
 const r=await f.coordinator.finalize(f.user.id,{protocol_version:4,prepare_id:p.command.prepare_id,request_id:p.command.request_id,conversation_id:f.conversation.id,
  status:'failure',error_code:'RUNTIME_UNAVAILABLE'});assert.equal(r.ok,false);if(!r.ok)assert.equal(r.code,'RUNTIME_UNAVAILABLE');
 const [c]=await f.db.select().from(conversations).where(eq(conversations.id,f.conversation.id));assert.ok(c.providerMetadata.native_live_failed_turn);
});
