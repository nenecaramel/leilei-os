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
type F=Awaited<ReturnType<typeof fixture>>;
const cases:Record<string,(f:F,owner:'desktop'|'releasing')=>Promise<void>>={
  ...Object.fromEntries((['send','edit','retry'] as const).map(operation=>[`prepare ${operation}`,async(f:F,owner:'desktop'|'releasing')=>{
    await f.setOwner(owner);
    const result=await f.coordinator.prepare(f.user.id,{dispatch_target:'claude_code',request_id:randomUUID(),conversation_id:f.conversation.id,
      operation,...(operation==='send'?{expected_head_message_id:f.completed.assistantMessageId,text:'synthetic'}:
      {target_user_message_id:f.initial.command.canonical_user_message_id!,...(operation==='edit'?{text:'synthetic edit'}:{})})});
    assert.equal(result.ok,false);if(result.ok)throw Error('owner admitted');assert.equal(result.code,owner==='releasing'?'NATIVE_SESSION_SWITCHING':'SESSION_OWNED_BY_DESKTOP');
  }])) as Record<string,(f:F,owner:'desktop'|'releasing')=>Promise<void>>,
  async 'execution admission and renewal'(f,owner){const next=await f.send();assert.ok(next.ok);if(!next.ok)throw Error('prepare');
    await f.execute(next.command.prepare_id);const input=f.admission(next.command);assert.equal(await f.relay.checkExecutionAdmission(input),true);
    await f.setOwner(owner);assert.equal(await f.relay.checkExecutionAdmission(input),false);assert.equal(await f.relay.renewExecutionLease(input),false);},
  ...Object.fromEntries((['queued','started'] as const).map(phase=>[`input ${phase}`,async(f:F,owner:'desktop'|'releasing')=>{
    const next=await f.send();assert.ok(next.ok);if(!next.ok)throw Error('prepare');await f.execute(next.command.prepare_id);
    const input=f.admission(next.command);if(phase==='started'){assert.ok(await bindNativeLiveInput(f.db,{...input,phase:'queued'}));
      assert.equal(await checkQueuedNativeLiveInput(f.db,input),true);}
    await f.setOwner(owner);assert.equal(await bindNativeLiveInput(f.db,{...input,phase}),null);
    if(phase==='started'){assert.equal(await checkQueuedNativeLiveInput(f.db,input),false);assert.equal(await f.relay.renewExecutionLease(input),false);}
  }])) as Record<string,(f:F,owner:'desktop'|'releasing')=>Promise<void>>,
  async 'background prepare'(f,owner){await f.setOwner(owner);await assert.rejects(f.relay.prepareBackgroundResult(f.background),{code:'BACKGROUND_CONFLICT'});},
  async 'background submit'(f,owner){await f.relay.prepareBackgroundResult(f.background);await f.setOwner(owner);
    assert.equal((await f.relay.submitBackgroundResult({...f.background,result:f.backgroundResult})).outcome,'stale');},
  async 'Wake source concerns'(f,owner){
    const {NativeLiveConcernService}=await import('../src/domains/bridge/concern/native-live-concern.js');
    await new NativeLiveConcernService(f.db).create({userId:f.user.id,content:'synthetic concern',considerInMinutes:300,
      expiresAt:new Date(Date.now()+172800000).toISOString()});
    const service=new NativeLiveSilenceWakeService(f.db);
    assert.ok((await service.readSchedule({userId:f.user.id}))?.concernDueAt);
    await f.setOwner(owner);assert.equal((await service.readSchedule({userId:f.user.id}))?.concernDueAt,null);
  },
  async 'Wake admission'(f,owner){const w=await f.wake();const input={userId:f.user.id,listenerInstanceId:f.listener,reservationId:w.prepareId,
    requestId:w.requestId,conversationId:f.conversation.id,runtimeMode:'resume' as const,canonicalUserMessageId:null,
    parentProviderSessionId:w.parentProviderSessionId,parentProviderCheckpointId:w.parentProviderCheckpointId!};
    assert.equal(await f.relay.checkExecutionAdmission(input),true);await f.setOwner(owner);assert.equal(await f.relay.checkExecutionAdmission(input),false);},
  async 'quiet Wake cursor'(f,owner){const w=await f.wake();await f.setOwner(owner);
    const result=await f.coordinator.finalize(f.user.id,{...f.backgroundResult,prepare_id:w.prepareId,request_id:w.requestId,
      normalized_events:[{type:'text',payload:{text:'<quiet />'}}]});
    assert.ok(result.ok&&result.outcome==='wake_stale');
    const cp=await f.canonical.getProviderCheckpointForHead({...f.scope,canonicalMessageId:f.completed.assistantMessageId});
    assert.equal(cp!.runtimeMetadata?.native_live_resume_tail,undefined);},
  async 'task control'(f,owner){await f.setOwner(owner);await assert.rejects(createTaskControl(f.db,{userId:f.user.id,
    prepareId:f.initial.command.prepare_id,controlId:randomUUID(),payload:{action:'list'}}),{code:'TURN_NOT_ACTIVE'});},
  async 'manual compact'(f,owner){await f.setOwner(owner);await assert.rejects(new NativeLiveManualCompactService(f.db,undefined,
    {isListenerOnline:async()=>true}).create(f.scope),{code:'CONVERSATION_BUSY'});},
};
for(const owner of ['desktop','releasing'] as const)for(const [name,run]of Object.entries(cases))test(`owner row ${owner} overrides executable JSON: ${name}`,{skip:!enabled},async t=>run(await fixture(t),owner));

test('missing owner row allows a new conversation first prepare, admission, renewal and finalize',{skip:!enabled},async t=>{
  const f=await fixture(t),c=await f.canonical.createConversation({userId:f.user.id});
  assert.equal((await f.db.execute(sql`SELECT 1 FROM native_live_session_owners WHERE conversation_id=${c.id}::uuid`)).length,0);
  const prepared=await f.coordinator.prepare(f.user.id,{dispatch_target:'claude_code',request_id:randomUUID(),conversation_id:c.id,
    operation:'send',expected_head_message_id:null,text:'synthetic first'});assert.ok(prepared.ok);if(!prepared.ok)throw Error('prepare');
  await f.execute(prepared.command.prepare_id);const input=f.admission(prepared.command);
  assert.equal(await f.relay.checkExecutionAdmission(input),true);assert.equal(await f.relay.renewExecutionLease(input),true);
  const result=await f.coordinator.finalize(f.user.id,{...f.backgroundResult,prepare_id:prepared.command.prepare_id,request_id:prepared.command.request_id,
    conversation_id:c.id,provider_session_id:randomUUID()});assert.ok(result.ok&&result.outcome==='completed');
});

test('real attach begin release attach keeps row authoritative without JSON copies and restores admission',{skip:!enabled},async t=>{
  const f=await fixture(t);
  const input={...f.scope,sessionId:f.session,checkpointId:f.base,revision:'2'.repeat(64),effectiveWorkingDirectory:'/synthetic',
    expectedHeadMessageId:f.completed.assistantMessageId,expectedRevision:null as string|null,checkpointIds:[f.base],completedTurnCheckpointIds:[f.base]};
  const aligned=async(expected:string)=>{const [r]=await f.db.execute<{row_owner:string;json_owner:string}>(sql`SELECT o.owner AS row_owner,
    c.provider_metadata->'nativeSessionSource'->>'owner' AS json_owner FROM conversations c JOIN native_live_session_owners o
    ON o.conversation_id=c.id AND o.user_id=c.user_id WHERE c.id=${f.conversation.id}::uuid`);assert.deepEqual(r,{row_owner:expected,json_owner:null});};
  await attachNativeContinuation(f.db,input);await aligned('leileios');
  let state=await readNativeContinuationState(f.db,input);
  const {beginNativeContinuationRelease}=await import("../src/domains/conversation/native-session-continuation-repository.js");
  const begun=await beginNativeContinuationRelease(f.db,{...input,expectedRevision:state.expectedRevision});
  await releaseNativeContinuation(f.db,{...input,expectedRevision:begun.expectedRevision});await aligned('desktop');
  const blocked=await f.send();assert.equal(blocked.ok,false);if(!blocked.ok)assert.equal(blocked.code,'SESSION_OWNED_BY_DESKTOP');
  state=await readNativeContinuationState(f.db,input);
  await attachNativeContinuation(f.db,{...input,expectedRevision:state.expectedRevision});await aligned('leileios');
  const prepared=await f.send();assert.ok(prepared.ok);if(!prepared.ok)throw Error('prepare after attach');
  await f.execute(prepared.command.prepare_id);assert.equal(await f.relay.checkExecutionAdmission(f.admission(prepared.command)),true);
});
