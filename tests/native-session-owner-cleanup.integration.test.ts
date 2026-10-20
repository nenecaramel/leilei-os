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
import { attachNativeContinuation, releaseNativeContinuation, readNativeContinuationState } from '../src/domains/conversation/native-session-continuation-repository.js';

import * as continuation from '../src/domains/conversation/native-session-continuation-repository.js';

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
  const scope={userId:user.id,conversationId:conversation.id};
  const send=()=>coordinator.prepare(user.id,{dispatch_target:'claude_code',request_id:randomUUID(),conversation_id:conversation.id,
    operation:'send',expected_head_message_id:completed.assistantMessageId,text:'synthetic next'});
  return {db,user,scope,conversation,coordinator,completed,session,base,execute,send};
}

async function releaseFixture(t:test.TestContext){
 const f=await fixture(t);
 const full={...f.scope,sessionId:f.session,checkpointId:f.base,revision:'1'.repeat(64),effectiveWorkingDirectory:'/synthetic',
  expectedHeadMessageId:f.completed.assistantMessageId,expectedRevision:null as string|null,checkpointIds:[f.base],completedTurnCheckpointIds:[f.base]};
 const beginInput={...f.scope,sessionId:f.session,expectedHeadMessageId:f.completed.assistantMessageId,expectedRevision:null as string|null};
 const begin=()=>continuation.beginNativeContinuationRelease(f.db,beginInput);
 return {...f,full,beginInput,begin};
}

test('continuation state uses owner row and ignores conflicting legacy JSON ownership', {skip:!enabled}, async t=>{
 const f=await releaseFixture(t);await attachNativeContinuation(f.db,f.full);
 const state=await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session});
 await f.db.execute(sql`UPDATE conversations SET provider_metadata=jsonb_set(jsonb_set(provider_metadata,'{nativeSessionSource,owner}','"desktop"'::jsonb),'{nativeSessionSource,revision}','"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"'::jsonb) WHERE id=${f.conversation.id}::uuid`);
 const actual=await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session});
 assert.equal(actual.owner,'leileios');assert.equal(actual.expectedRevision,state.expectedRevision);
});

test('attach begin cancel and complete leave owner/revision only in the row', {skip:!enabled}, async t=>{
 const f=await releaseFixture(t);
 const assertNoCopy=async()=>{
  const [c]=await f.db.select().from(conversations).where(eq(conversations.id,f.conversation.id));
  const source=c.providerMetadata.nativeSessionSource as Record<string,unknown>;
  assert.equal(Object.hasOwn(source,'owner'),false);assert.equal(Object.hasOwn(source,'revision'),false);
 };
 await attachNativeContinuation(f.db,f.full);await assertNoCopy();
 let state=await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session});
 const begin=await continuation.beginNativeContinuationRelease(f.db,{...f.beginInput,expectedRevision:state.expectedRevision});await assertNoCopy();
 await continuation.cancelNativeContinuationRelease(f.db,{...f.scope,expectedRevision:begin.expectedRevision});await assertNoCopy();
 state=await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session});
 const again=await continuation.beginNativeContinuationRelease(f.db,{...f.beginInput,expectedRevision:state.expectedRevision});
 await releaseNativeContinuation(f.db,{...f.full,expectedRevision:again.expectedRevision});await assertNoCopy();
 assert.equal((await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session})).owner,'desktop');
});

test('legacy direct continuation release is refused without changing ownership', {skip:!enabled}, async t=>{
 const f=await releaseFixture(t);
 await assert.rejects(releaseNativeContinuation(f.db,f.full),{code:'NATIVE_RELEASE_BEGIN_REQUIRED'});
 assert.equal((await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session})).owner,'leileios');
});

test('stale JSON cannot override owner on finalize or cancel and cannot stale the native cursor', {skip:!enabled}, async t=>{
 const f=await releaseFixture(t);await attachNativeContinuation(f.db,f.full);
 const state=await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session});
 const begin=await continuation.beginNativeContinuationRelease(f.db,{...f.beginInput,expectedRevision:state.expectedRevision});
 await f.db.execute(sql`UPDATE conversations SET provider_metadata=jsonb_set(jsonb_set(provider_metadata,'{nativeSessionSource,owner}','"desktop"'::jsonb),'{nativeSessionSource,revision}','"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"'::jsonb) WHERE id=${f.conversation.id}::uuid`);
 const cancelled=await continuation.cancelNativeContinuationRelease(f.db,{...f.scope,expectedRevision:begin.expectedRevision});
 assert.equal(cancelled.owner,'leileios');
 const repeated=await continuation.cancelNativeContinuationRelease(f.db,{...f.scope,expectedRevision:begin.expectedRevision});
 assert.equal(repeated.expectedRevision,cancelled.expectedRevision);
 await f.db.execute(sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata,'{nativeSessionSource,owner}','"desktop"'::jsonb) WHERE id=${f.conversation.id}::uuid`);
 const next=await f.send();assert.ok(next.ok);if(!next.ok)throw Error('send refused');
 await f.execute(next.command.prepare_id);
 const completed=await f.coordinator.finalize(f.user.id,{protocol_version:4,prepare_id:next.command.prepare_id,request_id:next.command.request_id,conversation_id:f.conversation.id,status:'success',provider_session_id:f.session,provider_checkpoint_id:randomUUID(),effective_working_directory:'/synthetic',normalized_events:[{type:'text',payload:{text:'synthetic'}}]});assert.ok(completed.ok);
 const current=await readNativeContinuationState(f.db,{...f.scope,sessionId:f.session});
 assert.equal(current.owner,'leileios');assert.equal(current.expectedRevision,cancelled.expectedRevision);
});
