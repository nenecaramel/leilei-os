import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from '../src/database/client.js';
import { users, conversationProviderSessionCheckpoints, nativeLiveProviderSessionCleanups } from '../src/database/schema.js';
import { DrizzleNativeLiveConversationRepository } from '../src/domains/conversation/native-live-conversation-repository.js';
import { NativeLiveConversationService } from '../src/domains/conversation/native-live-conversation-service.js';
import { NativeLiveBackendTurnCoordinator } from '../src/domains/bridge/turn/native-live-backend-turn-coordinator.js';
import { DrizzleNativeLiveBackendTurnPort } from '../src/domains/bridge/turn/native-live-backend-turn-repository.js';
const enabled = process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST === '1';
test('five linear sends share session A; Retry/Edit fork exact parent and continuation resumes replacement', { skip: !enabled }, async () => {
    const database = createDatabase(process.env.DATABASE_URL!, { ssl: false });
    try {
        const [user] = await database.db.insert(users).values({ email: `branch-${randomUUID()}@example.com`, displayName: 'Branch session test' }).returning();
        const repo = new DrizzleNativeLiveConversationRepository(database.db), service = new NativeLiveConversationService(repo), port = new DrizzleNativeLiveBackendTurnPort(database.db), coordinator = new NativeLiveBackendTurnCoordinator(port, randomUUID);
        const conversation = await service.createConversation({ userId: user.id, title: 'branch checkpoint' });
        let head: string | null = null;
        const cps: string[] = [], messages: string[] = [], userIds: string[] = [];
        const finish = async (command: any, session: string) => {
            const cp = randomUUID();
            const result = await coordinator.finalize(user.id, { protocol_version: 4, prepare_id: command.prepare_id, request_id: command.request_id, conversation_id: conversation.id, status: 'success', provider_session_id: session, provider_checkpoint_id: cp, normalized_events: [{ type: 'text', payload: { text: 'answer' } }, { type: 'result', payload: { status: 'success', final_text: 'answer' } }] });
            assert.equal(result.ok, true, JSON.stringify(result));
            if (!result.ok || !('assistantMessageId' in result))
                throw Error('finalize failed');
            const checkpoint = await repo.getProviderCheckpointForHead({ userId: user.id, conversationId: conversation.id, canonicalMessageId: result.assistantMessageId });
            assert.equal(checkpoint?.providerCheckpointId, cp);
            return { cp, head: result.assistantMessageId };
        };
        for (let i = 0; i < 5; i++) {
            const prepared = await coordinator.prepare(user.id, { dispatch_target: 'claude_code', request_id: randomUUID(), operation: 'send', conversation_id: conversation.id, expected_head_message_id: head, text: `turn ${i + 1}` });
            assert.equal(prepared.ok, true);
            if (!prepared.ok)
                throw Error('prepare failed');
            assert.equal(prepared.command.runtime_mode, i ? 'resume' : 'new');
            assert.equal(prepared.command.parent_provider_session_id, i ? 'A' : null);
            assert.equal(prepared.command.parent_provider_checkpoint_id, i ? cps[i - 1] : null);
            userIds.push(prepared.command.canonical_user_message_id!);
            const done = await finish(prepared.command, 'A');
            cps.push(done.cp);
            head = done.head;
            messages.push(head);
        }
        assert.equal(new Set(cps).size, 5);
        const retry = await coordinator.prepare(user.id, { dispatch_target: 'claude_code', request_id: randomUUID(), operation: 'retry', conversation_id: conversation.id, target_user_message_id: userIds[1] });
        assert.equal(retry.ok, true);
        if (!retry.ok)
            throw Error('retry failed');
        assert.equal(retry.command.runtime_mode, 'fork');
        assert.equal(retry.command.parent_provider_session_id, 'A');
        assert.equal(retry.command.parent_provider_checkpoint_id, cps[0]);
        head = (await finish(retry.command, 'B')).head;
        const cleanups = await database.db.select().from(nativeLiveProviderSessionCleanups).where(eq(nativeLiveProviderSessionCleanups.userId, user.id));
        assert.equal(cleanups.some(x => x.providerSessionId === 'A'), false);
        const continuation = await coordinator.prepare(user.id, { dispatch_target: 'claude_code', request_id: randomUUID(), operation: 'send', conversation_id: conversation.id, expected_head_message_id: head, text: 'after retry' });
        assert.equal(continuation.ok, true);
        if (!continuation.ok)
            throw Error('send failed');
        assert.equal(continuation.command.runtime_mode, 'resume');
        assert.equal(continuation.command.parent_provider_session_id, 'B');
        head = (await finish(continuation.command, 'B')).head;
        const edit = await coordinator.prepare(user.id, { dispatch_target: 'claude_code', request_id: randomUUID(), operation: 'edit', conversation_id: conversation.id, target_user_message_id: userIds[1], text: 'edited turn2' });
        assert.equal(edit.ok, true);
        if (!edit.ok)
            throw Error('edit failed');
        assert.equal(edit.command.runtime_mode, 'fork');
        assert.equal(edit.command.parent_provider_checkpoint_id, cps[0]);
        const edited = await finish(edit.command, 'C');
        const finalCleanups = await database.db.select().from(nativeLiveProviderSessionCleanups).where(eq(nativeLiveProviderSessionCleanups.userId, user.id));
        assert.equal(finalCleanups.some(x => x.providerSessionId === 'A'), false);
        assert.equal(finalCleanups.some(x => x.providerSessionId === 'B'), true);
        const remaining = await database.db.select().from(conversationProviderSessionCheckpoints).where(eq(conversationProviderSessionCheckpoints.userId, user.id));
        assert.equal(remaining.filter(x => x.providerSessionId === 'A').length, 1);
        await database.db.update(conversationProviderSessionCheckpoints).set({providerCheckpointId:null}).where(eq(conversationProviderSessionCheckpoints.canonicalMessageId,edited.head));
        const missingModern = await coordinator.prepare(user.id,{dispatch_target:'claude_code',request_id:randomUUID(),operation:'send',conversation_id:conversation.id,expected_head_message_id:edited.head,text:'cannot downgrade'});
        assert.equal(missingModern.ok,false);if(!missingModern.ok)assert.equal(missingModern.code,'BRANCH_POINT_INVALID');
    }
    finally {
        await database.close();
    }
});
test('queued cleanup cannot reserve a still-referenced provider session, including another conversation', { skip: !enabled }, async () => {
    const database = createDatabase(process.env.DATABASE_URL!, { ssl: false });
    try {
        const { nativeLiveRuntimeListenerLeases } = await import('../src/database/schema.js');
        const { DrizzleNativeLiveProviderSessionCleanupRepository } = await import('../src/domains/bridge/provider-session/native-live-provider-session-cleanup.js');
        const [user] = await database.db.insert(users).values({ email: `shared-${randomUUID()}@example.com`, displayName: 'Shared cleanup' }).returning();
        const repo = new DrizzleNativeLiveConversationRepository(database.db), service = new NativeLiveConversationService(repo);
        const one = await service.createConversation({ userId: user.id, title: 'one' }), two = await service.createConversation({ userId: user.id, title: 'two' });
        const parent = await repo.appendUserMessage({ userId: user.id, conversationId: two.id, parentMessageId: null });
        const message = await repo.appendAssistantMessage({ userId: user.id, conversationId: two.id, parentMessageId: parent.id });
        await repo.bindProviderCheckpoint({ userId: user.id, conversationId: two.id, canonicalMessageId: message.id, checkpoint: { provider: 'claude_code', providerSessionId: 'shared-A', providerCheckpointId: randomUUID() } });
        const listener = randomUUID();
        await database.db.insert(nativeLiveRuntimeListenerLeases).values({ userId: user.id, dispatchTarget: 'claude_code', listenerInstanceId: listener, leaseExpiresAt: new Date(Date.now() + 300000) });
        await database.db.insert(nativeLiveProviderSessionCleanups).values({ userId: user.id, provider: 'claude_code', providerSessionId: 'shared-A', status: 'pending' });
        const cleanup = new DrizzleNativeLiveProviderSessionCleanupRepository(database.db);
        assert.equal(await cleanup.reserveNext({ userId: user.id, listenerInstanceId: listener }), null);
        await repo.deleteConversation({ userId: user.id, conversationId: one.id });
        assert.equal(await cleanup.reserveNext({ userId: user.id, listenerInstanceId: listener }), null);
        await repo.deleteConversation({ userId: user.id, conversationId: two.id });
        const reserved = await cleanup.reserveNext({ userId: user.id, listenerInstanceId: listener });
        assert.equal(reserved?.providerSessionId, 'shared-A');
    }
    finally {
        await database.close();
    }
});
test('compact advances only the head transcript checkpoint; earlier shared-session UUID stays exact', { skip: !enabled }, async () => {
    const database = createDatabase(process.env.DATABASE_URL!, { ssl: false });
    try {
        const { NativeLiveManualCompactService } = await import('../src/domains/bridge/turn/native-live-manual-compact.js');
        const { nativeLiveRuntimeListenerLeases } = await import('../src/database/schema.js');
        const [user] = await database.db.insert(users).values({ email: `compact-${randomUUID()}@example.com`, displayName: 'Compact checkpoint' }).returning();
        const repo = new DrizzleNativeLiveConversationRepository(database.db), service = new NativeLiveConversationService(repo);
        const conversation = await service.createConversation({ userId: user.id, title: 'compact' });
        let parent: string | null = null;
        const assistants: string[] = [], points: string[] = [];
        for (let i = 0; i < 2; i++) {
            const u = await repo.appendUserMessage({ userId: user.id, conversationId: conversation.id, parentMessageId: parent });
            const a = await repo.appendAssistantMessage({ userId: user.id, conversationId: conversation.id, parentMessageId: u.id });
            const cp = randomUUID();
            await repo.bindProviderCheckpoint({ userId: user.id, conversationId: conversation.id, canonicalMessageId: a.id, checkpoint: { provider: 'claude_code', providerSessionId: 'compact-A', providerCheckpointId: cp } });
            assistants.push(a.id);
            points.push(cp);
            parent = a.id;
        }
        const listener = randomUUID();
        await database.db.insert(nativeLiveRuntimeListenerLeases).values({ userId: user.id, dispatchTarget: 'claude_code', listenerInstanceId: listener, leaseExpiresAt: new Date(Date.now() + 300000) });
        await repo.setCurrentHead({ userId: user.id, conversationId: conversation.id, messageId: parent! });
        const compact = new NativeLiveManualCompactService(database.db);
        await compact.create({ userId: user.id, conversationId: conversation.id });
        const reserved = await compact.reserveNext({ userId: user.id, listenerInstanceId: listener });
        assert.ok(reserved);
        assert.equal(reserved.providerCheckpointId,points[1]);
        const next = randomUUID();
        assert.equal(await compact.complete({ userId: user.id, listenerInstanceId: listener, reservationId: reserved.reservationId, outcome: { status: 'success', result: { providerSessionId: 'compact-A', providerCheckpointId: next, contextUsage: null, boundary: { source: 'test' }, summary: 'compact' } } }), 'completed');
        const old = await repo.getProviderCheckpointForHead({ userId: user.id, conversationId: conversation.id, canonicalMessageId: assistants[0] });
        const head = await repo.getProviderCheckpointForHead({ userId: user.id, conversationId: conversation.id, canonicalMessageId: assistants[1] });
        assert.equal(old?.providerCheckpointId, points[0]);
        assert.equal(head?.providerCheckpointId, next);
        assert.equal(head?.providerSessionId, 'compact-A');
    }
    finally {
        await database.close();
    }
});
for (const origin of ['legacy', 'external'] as const) {
    test(`${origin} first continuation forks once; subsequent V4 sends resume new branch`, { skip: !enabled }, async () => {
        const database = createDatabase(process.env.DATABASE_URL!, { ssl: false });
        try {
            const [user] = await database.db.insert(users).values({ email: `${origin}-${randomUUID()}@example.com`, displayName: 'Transition' }).returning();
            const repo = new DrizzleNativeLiveConversationRepository(database.db), service = new NativeLiveConversationService(repo), coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db), randomUUID);
            const conversation = await service.createConversation({ userId: user.id, title: origin });
            let head: string | null = null;
            if (origin === 'legacy') {
                const u = await repo.appendUserMessage({ userId: user.id, conversationId: conversation.id, parentMessageId: null });
                const a = await repo.appendAssistantMessage({ userId: user.id, conversationId: conversation.id, parentMessageId: u.id });
                head = a.id;
                await repo.bindProviderCheckpoint({ userId: user.id, conversationId: conversation.id, canonicalMessageId: a.id, checkpoint: { provider: 'claude_code', providerSessionId: 'source-X', providerCheckpointId: null } });
                await repo.setCurrentHead({ userId: user.id, conversationId: conversation.id, messageId: head });
            }
            else {
                await database.db.execute(sql `INSERT INTO native_live_conversation_provider_bootstraps(conversation_id,user_id,provider,source_provider_session_id,effective_working_directory) VALUES(${conversation.id}::uuid,${user.id}::uuid,'claude_code','source-X','/private/tmp/test')`);
            }
            const first = await coordinator.prepare(user.id, { dispatch_target: 'claude_code', request_id: randomUUID(), operation: 'send', conversation_id: conversation.id, expected_head_message_id: head, text: 'first continuation' });
            assert.equal(first.ok, true);
            if (!first.ok)
                throw Error(JSON.stringify(first));
            assert.equal(first.command.runtime_mode, 'fork');
            assert.equal(first.command.parent_provider_session_id, 'source-X');
            assert.equal(first.command.parent_provider_checkpoint_id, null);
            const cp = randomUUID();
            const done = await coordinator.finalize(user.id, { protocol_version: 4, prepare_id: first.command.prepare_id, request_id: first.command.request_id, conversation_id: conversation.id, status: 'success', provider_session_id: 'branch-A', provider_checkpoint_id: cp, ...(origin === 'external' ? { effective_working_directory: '/private/tmp/test' } : {}), normalized_events: [{ type: 'text', payload: { text: 'ok' } }, { type: 'result', payload: { status: 'success', final_text: 'ok' } }] });
            assert.equal(done.ok, true, JSON.stringify(done));
            if (!done.ok || !('assistantMessageId' in done))
                throw Error(JSON.stringify(done));
            const next = await coordinator.prepare(user.id, { dispatch_target: 'claude_code', request_id: randomUUID(), operation: 'send', conversation_id: conversation.id, expected_head_message_id: done.assistantMessageId, text: 'keep branch' });
            assert.equal(next.ok, true);
            if (!next.ok)
                throw Error(JSON.stringify(next));
            assert.equal(next.command.runtime_mode, 'resume');
            assert.equal(next.command.parent_provider_session_id, 'branch-A');
            assert.equal(next.command.parent_provider_checkpoint_id, cp);
            const downgrade = await coordinator.finalize(user.id, { protocol_version: 4, prepare_id: next.command.prepare_id, request_id: next.command.request_id, conversation_id: conversation.id, status: 'success', provider_session_id: 'branch-A', normalized_events: [{ type: 'result', payload: { status: 'success', final_text: 'missing checkpoint' } }] });
            assert.equal(downgrade.ok, false);
            if (!downgrade.ok)
                assert.equal(downgrade.code, 'RESULT_MISMATCH');
        }
        finally {
            await database.close();
        }
    });
}

test('bootstrap and in-flight preparation retain a queued shared session until their references end', {skip:!enabled}, async()=>{
 const database=createDatabase(process.env.DATABASE_URL!,{ssl:false});
 try{
  const {nativeLiveRuntimeListenerLeases}=await import('../src/database/schema.js');
  const {DrizzleNativeLiveProviderSessionCleanupRepository}=await import('../src/domains/bridge/provider-session/native-live-provider-session-cleanup.js');
  const [user]=await database.db.insert(users).values({email:`references-${randomUUID()}@example.com`,displayName:'Reference safety'}).returning();
  const repo=new DrizzleNativeLiveConversationRepository(database.db), service=new NativeLiveConversationService(repo),coordinator=new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db),randomUUID);
  const conversation=await service.createConversation({userId:user.id,title:'references'}),listener=randomUUID();
  await database.db.insert(nativeLiveRuntimeListenerLeases).values({userId:user.id,dispatchTarget:'claude_code',listenerInstanceId:listener,leaseExpiresAt:new Date(Date.now()+300_000)});
  await database.db.insert(nativeLiveProviderSessionCleanups).values({userId:user.id,provider:'claude_code',providerSessionId:'protected-X',status:'pending'});
  await database.db.execute(sql`INSERT INTO native_live_conversation_provider_bootstraps(conversation_id,user_id,provider,source_provider_session_id,effective_working_directory) VALUES(${conversation.id}::uuid,${user.id}::uuid,'claude_code','protected-X','/private/tmp/test')`);
  const cleanup=new DrizzleNativeLiveProviderSessionCleanupRepository(database.db);assert.equal(await cleanup.reserveNext({userId:user.id,listenerInstanceId:listener}),null);
  const prepared=await coordinator.prepare(user.id,{dispatch_target:'claude_code',request_id:randomUUID(),operation:'send',conversation_id:conversation.id,expected_head_message_id:null,text:'continue'});assert.equal(prepared.ok,true);if(!prepared.ok)throw Error(JSON.stringify(prepared));
  await database.db.execute(sql`UPDATE native_live_conversation_provider_bootstraps SET consumed_at=now() WHERE conversation_id=${conversation.id}::uuid`);
  assert.equal(await cleanup.reserveNext({userId:user.id,listenerInstanceId:listener}),null);
  await coordinator.finalize(user.id,{protocol_version:4,prepare_id:prepared.command.prepare_id,request_id:prepared.command.request_id,conversation_id:conversation.id,status:'failure',error_code:'ABORTED'});
  assert.equal((await cleanup.reserveNext({userId:user.id,listenerInstanceId:listener}))?.providerSessionId,'protected-X');
 }finally{await database.close();}
});
