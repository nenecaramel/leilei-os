import assert from 'node:assert/strict';
import test from 'node:test';
import {eq} from 'drizzle-orm';
import {createDatabase} from '../src/database/client.js';
import {users,conversations,nativeLiveProviderSessionCleanups,nativeLiveTurnPreparations} from '../src/database/schema.js';
import {NativeLiveBackendTurnCoordinator} from '../src/domains/bridge/turn/native-live-backend-turn-coordinator.js';
import {DrizzleNativeLiveBackendTurnPort} from '../src/domains/bridge/turn/native-live-backend-turn-repository.js';
import {NativeLiveSilenceWakeService,silenceWakePreparationId} from '../src/domains/bridge/turn/native-live-silence-wake.js';
import {DrizzleNativeLiveConversationRepository} from '../src/domains/conversation/native-live-conversation-repository.js';
import {NativeLiveConversationService} from '../src/domains/conversation/native-live-conversation-service.js';

const enabled=process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST==='1';
for(const scenario of ['quiet','stale','fork-source'] as const) test(`discarded ${scenario} wake never schedules source-session deletion in PostgreSQL`,{skip:!enabled},async t=>{
 const databaseUrl=process.env.DATABASE_URL;assert.ok(databaseUrl);
 const {isolatedPostgresTarget,verifyIsolatedPostgresTarget}=await import('../scripts/isolated-postgres-target.mjs');
 await verifyIsolatedPostgresTarget(isolatedPostgresTarget(databaseUrl));
 const database=createDatabase(databaseUrl,{ssl:false});
 const [user]=await database.db.insert(users).values({email:`wake-safety-${crypto.randomUUID()}@example.com`,displayName:'Synthetic wake safety'}).returning({id:users.id});
 t.after(async()=>{try{await database.db.delete(nativeLiveProviderSessionCleanups).where(eq(nativeLiveProviderSessionCleanups.userId,user.id));await database.db.delete(conversations).where(eq(conversations.userId,user.id));await database.db.delete(users).where(eq(users.id,user.id));}finally{await database.close();}});
 const service=new NativeLiveConversationService(new DrizzleNativeLiveConversationRepository(database.db));
 const conversation=await service.createConversation({userId:user.id,title:'Synthetic wake safety'});
 const port=new DrizzleNativeLiveBackendTurnPort(database.db);const coordinator=new NativeLiveBackendTurnCoordinator(port,()=>crypto.randomUUID());
 const foreground=await coordinator.prepare(user.id,{dispatch_target:'claude_code',request_id:crypto.randomUUID(),operation:'send',conversation_id:conversation.id,expected_head_message_id:null,text:'synthetic'});
 assert.ok(foreground.ok);if(!foreground.ok)throw new Error('prepare failed');
 const source=await coordinator.finalize(user.id,{protocol_version:4,prepare_id:foreground.command.prepare_id,request_id:foreground.command.request_id,conversation_id:conversation.id,status:'success',provider_session_id:'synthetic-source',provider_checkpoint_id:foreground.command.prepare_id,normalized_events:[{type:'text',payload:{text:'synthetic'}}]});
 assert.ok(source.ok && source.outcome==='completed');if(!source.ok || source.outcome!=='completed')throw new Error('finalize failed');
 let now=new Date();const silence=new NativeLiveSilenceWakeService(database.db,()=>now);
 const schedule=await silence.readSchedule({userId:user.id});assert.ok(schedule);now=new Date(schedule.postTurnDueAt);
 assert.equal((await silence.fire({userId:user.id,epochId:schedule.epochId,slot:'post_turn_idle'})).outcome,'queued');
 const prepareId=silenceWakePreparationId(schedule.epochId,'post_turn_idle');
 // Simulate the future same-session dispatch without enabling it in production.
 if(scenario!=='fork-source')await database.db.update(nativeLiveTurnPreparations).set({runtimeMode:'resume'}).where(eq(nativeLiveTurnPreparations.id,prepareId));
 const wake=await port.getPreparation({userId:user.id,prepareId});assert.ok(wake);
 if(scenario==='stale')assert.equal((await coordinator.prepare(user.id,{dispatch_target:'claude_code',request_id:crypto.randomUUID(),operation:'send',conversation_id:conversation.id,expected_head_message_id:source.assistantMessageId,text:'new synthetic input'})).ok,true);
 if(scenario==='fork-source')assert.equal(await port.discardWake({userId:user.id,preparation:wake,providerSessionId:'synthetic-source'}),'discarded');
 else {
  const result=await coordinator.finalize(user.id,{protocol_version:4,prepare_id:prepareId,request_id:wake.requestId,conversation_id:conversation.id,status:'success',provider_session_id:'synthetic-source',provider_checkpoint_id:prepareId,normalized_events:[{type:'text',payload:{text:scenario==='quiet'?'<quiet />':'stale synthetic output'}}]});
  assert.ok(result.ok);if(!result.ok)throw new Error('wake finalize failed');assert.equal(result.outcome,scenario==='quiet'?'wake_quiet':'wake_stale');
 }
 assert.equal(await port.getPreparation({userId:user.id,prepareId}),null);
 const cleanup=await database.db.select().from(nativeLiveProviderSessionCleanups).where(eq(nativeLiveProviderSessionCleanups.userId,user.id));assert.equal(cleanup.length,0);
 const after=await service.getConversation({userId:user.id,conversationId:conversation.id});assert.ok(after);assert.equal(after.currentHeadMessageId,source.assistantMessageId);
});
