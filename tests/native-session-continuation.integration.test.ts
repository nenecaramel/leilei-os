import { syncTestNativeSessionOwner } from "./helpers/native-session-turn.js";
import { setTestNativeSessionTurn } from "./helpers/native-session-turn.js";
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from '../src/database/client.js';
import { users, conversations, conversationMessages, conversationProviderSessionCheckpoints, nativeLiveRuntimeListenerLeases, nativeLiveTurnPreparations, nativeLiveRuntimeEvents } from '../src/database/schema.js';
import { DrizzleNativeLiveBackendTurnPort } from '../src/domains/bridge/turn/native-live-backend-turn-repository.js';
import { NativeLiveBackendTurnCoordinator } from '../src/domains/bridge/turn/native-live-backend-turn-coordinator.js';
const enabled = process.env.RUN_NATIVE_SESSION_PRESERVATION_DATABASE_TEST === '1';
const rev = (n: number) => n.toString(16).padStart(64, '0');
async function fixture(run: (f: any) => Promise<void>) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/leileios_native_session_test');
  assert.notEqual(process.env.NODE_ENV, 'production');
  const db = createDatabase(url.href, { ssl: false });
  const [user] = await db.db.insert(users).values({ email: `continuation-${randomUUID()}@example.com`, displayName: 'Synthetic continuation' }).returning();
  const api = await import('../src/domains/conversation/native-session-continuation-repository.js');
  const releaseWithBegin = async (database:any,request:any) => {
    const begin=await api.beginNativeContinuationRelease(database,{...request});
    return api.releaseNativeContinuation(database,{...request,expectedRevision:begin.expectedRevision});
  };
  const input = { userId: user!.id, conversationId: randomUUID(), sessionId: randomUUID(), checkpointId: randomUUID(), revision: rev(1),
    effectiveWorkingDirectory: '/synthetic/workspace', expectedHeadMessageId: null, expectedRevision: null };
  const state = () => api.readNativeContinuationState(db.db, { userId: user!.id, conversationId: input.conversationId, sessionId: input.sessionId });
  const attach = (next = {}) => api.attachNativeContinuation(db.db, { ...input, checkpointIds: [input.checkpointId], completedTurnCheckpointIds: [input.checkpointId], ...next });
  const count = async () => (await db.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, input.conversationId))).length;
  try { await run({ db: db.db, api, releaseWithBegin, input, state, attach, count }); }
  finally { await db.db.delete(nativeLiveRuntimeListenerLeases).where(eq(nativeLiveRuntimeListenerLeases.userId, user!.id)); await db.db.delete(conversations).where(eq(conversations.userId, user!.id)); await db.db.delete(users).where(eq(users.id, user!.id)); await db.close(); }
}

test('continuation attaches an empty UI and first send resumes the exact native checkpoint without imported messages', { skip: !enabled }, async () => fixture(async f => {
  const first = await f.attach(); assert.equal(first.inserted, 0); assert.equal(first.headMessageId, null);
  assert.equal(await f.count(), 0); assert.equal((await f.attach()).outcome, 'already_current');
  const port = new DrizzleNativeLiveBackendTurnPort(f.db);
  const result = await port.prepareSend({ prepareId: randomUUID(), userId: f.input.userId, requestId: randomUUID(), conversationId: f.input.conversationId, expectedHeadMessageId: null, text: 'synthetic new input', attachmentIds: [], executionSelection: null });
  assert.equal(result.ok, true, JSON.stringify(result));
  const [p] = await f.db.execute(sql`SELECT * FROM native_live_turn_preparations WHERE conversation_id = ${f.input.conversationId}::uuid`);
  assert.equal(p.runtime_mode, 'resume'); assert.equal(p.parent_provider_session_id, f.input.sessionId); assert.equal(p.parent_provider_checkpoint_id, f.input.checkpointId);
  assert.equal(await f.count(), 1);
  const listener = randomUUID(), later = new Date(Date.now() + 600_000);
  await f.db.insert(nativeLiveRuntimeListenerLeases).values({ userId: f.input.userId, dispatchTarget: 'claude_code', listenerInstanceId: listener, leaseExpiresAt: later });
  await f.db.update(nativeLiveTurnPreparations).set({ dispatchStatus: 'executing', executionStartedAt: new Date(), reservedBy: listener,
    reservedAt: new Date(), reservationExpiresAt: later }).where(eq(nativeLiveTurnPreparations.id, p.id));
  const { checkNativeLiveExecutionAdmission } = await import('../src/domains/bridge/relay/native-live-execution-admission.js');
  const admission = { userId: f.input.userId, listenerInstanceId: listener, reservationId: p.id, requestId: p.request_id,
    conversationId: f.input.conversationId, runtimeMode: 'resume' as const, canonicalUserMessageId: p.canonical_user_message_id,
    parentProviderSessionId: f.input.sessionId, parentProviderCheckpointId: f.input.checkpointId };
  assert.equal(await checkNativeLiveExecutionAdmission(f.db, admission), true);
  assert.equal(await checkNativeLiveExecutionAdmission(f.db, { ...admission, parentProviderCheckpointId: randomUUID() }), false);
  const { bindNativeLiveInput } = await import('../src/domains/bridge/relay/native-live-input-binding.js');
  const expectedBinding = { userMessageId: p.canonical_user_message_id, parentProviderCheckpointId: f.input.checkpointId };
  assert.deepEqual(await bindNativeLiveInput(f.db, { ...admission, phase: 'queued' }), expectedBinding);
  assert.deepEqual(await bindNativeLiveInput(f.db, { ...admission, phase: 'started' }), expectedBinding);
  assert.deepEqual(await bindNativeLiveInput(f.db, { ...admission, phase: 'started' }), expectedBinding);
  assert.equal(await checkNativeLiveExecutionAdmission(f.db, admission), true);
  assert.equal(await f.count(), 1, 'binding must not import history or create synthetic checkpoint messages');
  const completed = await new NativeLiveBackendTurnCoordinator(port).finalize(f.input.userId, {
    protocol_version: 4, prepare_id: p.id, request_id: p.request_id, conversation_id: f.input.conversationId,
    status: 'success', provider_session_id: f.input.sessionId, provider_checkpoint_id: randomUUID(),
    effective_working_directory: f.input.effectiveWorkingDirectory,
    normalized_events: [{ type: 'text', payload: { text: 'synthetic reply' } }],
  });
  assert.equal(completed.outcome, 'completed');
  const next = await port.prepareSend({ prepareId: randomUUID(), userId: f.input.userId, requestId: randomUUID(),
    conversationId: f.input.conversationId, expectedHeadMessageId: completed.assistantMessageId,
    text: 'synthetic second input', attachmentIds: [], executionSelection: null });
  assert.equal(next.ok, true);
  await f.db.update(nativeLiveRuntimeListenerLeases).set({ leaseExpiresAt: new Date(0) }).where(eq(nativeLiveRuntimeListenerLeases.userId, f.input.userId));
  assert.equal(await checkNativeLiveExecutionAdmission(f.db, admission), false);
  await assert.rejects(f.attach(), { code: 'NATIVE_CONVERSATION_BUSY' });
}));

test('continuation input binding keeps exact identity, source and lease fences before and after queueing', { skip: !enabled }, async t => {
  const { bindNativeLiveInput } = await import('../src/domains/bridge/relay/native-live-input-binding.js');
  for (const phase of ['queued', 'started'] as const) {
    for (const invalid of ['session', 'checkpoint', 'cwd', 'anchor', 'owner', 'revision', 'listener', 'expiry'] as const) {
      await t.test(`${phase}: rejects changed ${invalid}`, async () => fixture(async f => {
        await f.attach();
        const port = new DrizzleNativeLiveBackendTurnPort(f.db);
        const prepared = await port.prepareSend({ prepareId: randomUUID(), userId: f.input.userId, requestId: randomUUID(),
          conversationId: f.input.conversationId, expectedHeadMessageId: null, text: 'synthetic input', attachmentIds: [], executionSelection: null });
        assert.equal(prepared.ok, true);
        const [p] = await f.db.select().from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.conversationId, f.input.conversationId));
        const listener = randomUUID(), later = new Date(Date.now() + 600_000);
        await f.db.insert(nativeLiveRuntimeListenerLeases).values({ userId: f.input.userId, dispatchTarget: 'claude_code', listenerInstanceId: listener, leaseExpiresAt: later });
        await f.db.update(nativeLiveTurnPreparations).set({ dispatchStatus: 'executing', executionStartedAt: new Date(), reservedBy: listener,
          reservedAt: new Date(), reservationExpiresAt: later }).where(eq(nativeLiveTurnPreparations.id, p.id));
        const admission = { userId: f.input.userId, listenerInstanceId: listener, reservationId: p.id, requestId: p.requestId,
          conversationId: f.input.conversationId, runtimeMode: 'resume' as const, canonicalUserMessageId: p.canonicalUserMessageId,
          parentProviderSessionId: f.input.sessionId, parentProviderCheckpointId: f.input.checkpointId };
        if (phase === 'started') assert.ok(await bindNativeLiveInput(f.db, { ...admission, phase: 'queued' }));
        const [c] = await f.db.select().from(conversations).where(eq(conversations.id, f.input.conversationId));
        if (invalid === 'listener' || invalid === 'expiry') {
          await f.db.update(nativeLiveRuntimeListenerLeases).set(invalid === 'listener'
            ? { listenerInstanceId: randomUUID() } : { leaseExpiresAt: new Date(0) }).where(eq(nativeLiveRuntimeListenerLeases.userId, f.input.userId));
        } else {
          const field = { session: 'sessionId', checkpoint: 'checkpointId', cwd: 'effectiveWorkingDirectory', anchor: 'headMessageId', owner: 'owner', revision: 'revision' }[invalid];
          const value = invalid === 'cwd' ? '/synthetic/other' : invalid === 'owner' ? 'desktop' : invalid === 'revision' ? rev(99) : randomUUID();
          // Revision rotation before queueing alone is legitimate; changing the
          // source checkpoint at the same time proves this command is stale.
          const changed = { ...c.providerMetadata.nativeSessionSource, [field]: value,
            ...(invalid === 'revision' && phase === 'queued' ? { checkpointId: randomUUID() } : {}) };
          await f.db.update(conversations).set({ providerMetadata: { ...c.providerMetadata, nativeSessionSource: changed } }).where(eq(conversations.id, f.input.conversationId));
          if (invalid === 'owner' || invalid === 'revision') await syncTestNativeSessionOwner(f.db, { userId: f.input.userId, conversationId: f.input.conversationId });
        }
        assert.equal(await bindNativeLiveInput(f.db, { ...admission, phase }), null);
      }));
    }
  }
});

test('empty continuation release and reacquire are idempotent, CAS fenced, and preserve native ancestry', { skip: !enabled }, async () => fixture(async f => {
  await f.attach();
  const release = { ...f.input, expectedRevision: (await f.state()).expectedRevision, checkpointIds: [f.input.checkpointId], completedTurnCheckpointIds: [f.input.checkpointId] };
  const released = await f.releaseWithBegin(f.db, release);
  release.expectedRevision = (await f.state()).expectedRevision;
  assert.equal(released.owner, 'desktop'); assert.equal((await f.api.releaseNativeContinuation(f.db, release)).owner, 'desktop');
  const next = randomUUID();
  await assert.rejects(f.attach({ checkpointId: next, checkpointIds: [next], completedTurnCheckpointIds: [next], revision: rev(2), expectedRevision: (await f.state()).expectedRevision }), { code: 'EXPLICIT_BRANCH_SELECTION_REQUIRED' });
  const attached = await f.attach({ checkpointId: next, checkpointIds: [f.input.checkpointId, next], completedTurnCheckpointIds: [next], revision: rev(2), expectedRevision: (await f.state()).expectedRevision });
  assert.equal(attached.owner, 'leileios'); assert.equal(await f.count(), 0);
  await assert.rejects(f.api.releaseNativeContinuation(f.db, release), { code: 'STALE_NATIVE_PROJECTION' });
  await assert.rejects(f.attach({ sessionId: randomUUID(), expectedRevision: (await f.state()).expectedRevision }), { code: 'EXPLICIT_BRANCH_SELECTION_REQUIRED' });
  await assert.rejects(f.attach({ conversationId: randomUUID() }), { code: 'NATIVE_SESSION_ALREADY_ATTACHED' });
}));

test('a verified quiet tail on the current handoff checkpoint remains the first send cursor', { skip: !enabled }, async () => fixture(async f => {
  await f.attach();
  const u = randomUUID(), a = randomUUID(), tail = randomUUID(), owner = randomUUID();
  const { readNativeWriterGeneration } = await import('../src/domains/bridge/turn/turn-repository/session-owner.js');
  const writerGeneration = await readNativeWriterGeneration(f.db, { userId:f.input.userId,conversationId:f.input.conversationId });
  assert.ok(writerGeneration);

  await f.db.insert(conversationMessages).values([
    { id: u, userId: f.input.userId, conversationId: f.input.conversationId, role: 'user', status: 'completed' },
    { id: a, userId: f.input.userId, conversationId: f.input.conversationId, parentMessageId: u, role: 'assistant', status: 'completed' },
  ]);
  const [c] = await f.db.select().from(conversations).where(eq(conversations.id, f.input.conversationId));
  const source = { ...c.providerMetadata.nativeSessionSource, headMessageId: a };
  await f.db.update(conversations).set({ currentHeadMessageId: a, providerMetadata: { ...c.providerMetadata,
    nativeSessionSource: source } }).where(eq(conversations.id, f.input.conversationId));
  await setTestNativeSessionTurn(f.db,f.input.conversationId,{prepareId:owner,anchor:a});
  await f.db.insert(conversationProviderSessionCheckpoints).values({ userId: f.input.userId, conversationId: f.input.conversationId,
    canonicalMessageId: a, provider: 'claude_code', providerSessionId: f.input.sessionId, providerCheckpointId: f.input.checkpointId,
    effectiveWorkingDirectory: f.input.effectiveWorkingDirectory, runtimeMetadata: { native_live_resume_tail: {
      canonical_message_id: a, provider_session_id: f.input.sessionId, base_checkpoint_id: f.input.checkpointId,
      checkpoint_id: tail, cwd: f.input.effectiveWorkingDirectory, source_revision: (await f.state()).expectedRevision, presentation_owner_id: owner, writer_generation: writerGeneration,
    } } });
  const prepared = await new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(f.db)).prepare(f.input.userId,
    { request_id: randomUUID(), conversation_id: f.input.conversationId, operation: 'send', dispatch_target: 'claude_code',
      expected_head_message_id: a, text: 'synthetic after quiet' });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.equal(prepared.command.parent_provider_checkpoint_id, tail);
  const listener = randomUUID(), later = new Date(Date.now() + 600_000), command = prepared.command;
  await f.db.insert(nativeLiveRuntimeListenerLeases).values({ userId: f.input.userId, dispatchTarget: 'claude_code', listenerInstanceId: listener, leaseExpiresAt: later });
  await f.db.update(nativeLiveTurnPreparations).set({ dispatchStatus: 'executing', executionStartedAt: new Date(), reservedBy: listener,
    reservedAt: new Date(), reservationExpiresAt: later }).where(eq(nativeLiveTurnPreparations.id, command.prepare_id));
  const { bindNativeLiveInput } = await import('../src/domains/bridge/relay/native-live-input-binding.js');
  const admission = { userId: f.input.userId, listenerInstanceId: listener, reservationId: command.prepare_id, requestId: command.request_id,
    conversationId: f.input.conversationId, runtimeMode: 'resume' as const, canonicalUserMessageId: command.canonical_user_message_id,
    parentProviderSessionId: f.input.sessionId, parentProviderCheckpointId: tail };
  for (const phase of ['queued', 'started'] as const) assert.deepEqual(await bindNativeLiveInput(f.db, { ...admission, phase }),
    { userMessageId: command.canonical_user_message_id, parentProviderCheckpointId: tail });
}));

test('handoff follows a finalized local fork without importing its transcript and retains the canonical rows', { skip: !enabled }, async () => fixture(async f => {
  await f.attach();
  const u = randomUUID(), a = randomUUID(), fork = randomUUID(), cp = randomUUID();
  await f.db.insert(conversationMessages).values([
    { id: u, userId: f.input.userId, conversationId: f.input.conversationId, parentMessageId: null, role: 'user', status: 'completed', displayText: 'synthetic local input' },
    { id: a, userId: f.input.userId, conversationId: f.input.conversationId, parentMessageId: u, role: 'assistant', status: 'completed', displayText: 'synthetic local output' },
  ]);
  await f.db.insert(conversationProviderSessionCheckpoints).values({ userId: f.input.userId, conversationId: f.input.conversationId, canonicalMessageId: a, provider: 'claude_code', providerSessionId: fork, providerCheckpointId: cp, effectiveWorkingDirectory: f.input.effectiveWorkingDirectory });
  await f.db.update(conversations).set({ currentHeadMessageId: a }).where(eq(conversations.id, f.input.conversationId));
  const state = await f.api.readNativeContinuationState(f.db, { ...f.input, sessionId: fork });
  assert.equal(state.providerSessionId, fork); assert.equal(state.providerCheckpointId, cp);
  const release = { ...f.input, sessionId: fork, checkpointId: cp, checkpointIds: [cp], completedTurnCheckpointIds: [cp], revision: rev(2), expectedHeadMessageId: a, expectedRevision: state.expectedRevision };
  assert.equal((await f.releaseWithBegin(f.db, release)).providerSessionId, fork);
  assert.equal(await f.count(), 2);
  const after = await f.api.attachNativeContinuation(f.db, { ...release, expectedRevision: (await f.api.readNativeContinuationState(f.db, { ...f.input, sessionId: fork })).expectedRevision });
  assert.equal(after.headMessageId, a); assert.equal(await f.count(), 2);
}));

for (const operation of ['retry', 'edit'] as const) test(`continuation ${operation} branches only post-handoff input from exact external checkpoint`, { skip: !enabled }, async () => fixture(async f => {
  await f.attach();
  const u = randomUUID(), a = randomUUID(), cp = randomUUID();
  await f.db.insert(conversationMessages).values([
    { id: u, userId: f.input.userId, conversationId: f.input.conversationId, parentMessageId: null, role: 'user', status: 'completed' },
    { id: a, userId: f.input.userId, conversationId: f.input.conversationId, parentMessageId: u, role: 'assistant', status: 'completed' },
  ]);
  await f.db.insert(conversationProviderSessionCheckpoints).values({ userId: f.input.userId, conversationId: f.input.conversationId, canonicalMessageId: a, provider: 'claude_code', providerSessionId: f.input.sessionId, providerCheckpointId: cp, effectiveWorkingDirectory: f.input.effectiveWorkingDirectory });
  await f.db.update(conversations).set({ currentHeadMessageId: a }).where(eq(conversations.id, f.input.conversationId));
  const { conversationContentBlocks } = await import('../src/database/schema.js');
  await f.db.insert(conversationContentBlocks).values({ userId: f.input.userId, messageId: u, ordinal: 0, kind: 'text', rawType: 'text', text: 'synthetic original' });
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(f.db));
  const prepared = await coordinator.prepare(f.input.userId, { request_id: randomUUID(), conversation_id: f.input.conversationId,
    operation, dispatch_target: 'claude_code', target_user_message_id: u, ...(operation === 'edit' ? { text: 'edited synthetic' } : {}) });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  // Edit and Retry rewind the bound session in place.
  assert.equal(prepared.command.runtime_mode, 'resume'); assert.equal(prepared.command.parent_provider_session_id, f.input.sessionId);
  assert.equal(prepared.command.parent_provider_checkpoint_id, f.input.checkpointId);
}));

test('latest handoff anchor is immutable while a subsequent local turn forks the newly attached native checkpoint', { skip: !enabled }, async () => fixture(async f => {
  await f.attach();
  const oldUser = randomUUID(), oldReply = randomUUID(), localCheckpoint = randomUUID();
  await f.db.insert(conversationMessages).values([
    { id: oldUser, userId: f.input.userId, conversationId: f.input.conversationId, role: 'user', status: 'completed' },
    { id: oldReply, userId: f.input.userId, conversationId: f.input.conversationId, parentMessageId: oldUser, role: 'assistant', status: 'completed' },
  ]);
  await f.db.insert(conversationProviderSessionCheckpoints).values({ userId: f.input.userId, conversationId: f.input.conversationId, canonicalMessageId: oldReply, provider: 'claude_code', providerSessionId: f.input.sessionId, providerCheckpointId: localCheckpoint, effectiveWorkingDirectory: f.input.effectiveWorkingDirectory });
  await f.db.update(conversations).set({ currentHeadMessageId: oldReply }).where(eq(conversations.id, f.input.conversationId));
  const base = { ...f.input, expectedHeadMessageId: oldReply, expectedRevision: (await f.state()).expectedRevision, checkpointId: localCheckpoint, revision: rev(2), checkpointIds: [localCheckpoint], completedTurnCheckpointIds: [localCheckpoint] };
  await f.releaseWithBegin(f.db, base);
  const desktopCheckpoint = randomUUID();
  await f.api.attachNativeContinuation(f.db, { ...base, expectedRevision: (await f.state()).expectedRevision, revision: rev(3), checkpointId: desktopCheckpoint,
    checkpointIds: [localCheckpoint, desktopCheckpoint], completedTurnCheckpointIds: [desktopCheckpoint] });
  const before = await f.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, f.input.conversationId));
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(f.db));
  const refused = await coordinator.prepare(f.input.userId, { request_id: randomUUID(), conversation_id: f.input.conversationId, operation: 'edit',
    dispatch_target: 'claude_code', target_user_message_id: oldUser, text: 'forbidden old edit' });
  assert.equal(refused.ok, false); assert.equal(refused.code, 'BRANCH_POINT_INVALID');
  assert.deepEqual(await f.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, f.input.conversationId)), before);
  const prepared = await coordinator.prepare(f.input.userId, { request_id: randomUUID(), conversation_id: f.input.conversationId,
    operation: 'send', dispatch_target: 'claude_code', expected_head_message_id: oldReply, text: 'new local turn' });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.equal(prepared.command.runtime_mode, 'resume'); assert.equal(prepared.command.parent_provider_checkpoint_id, desktopCheckpoint);
  const command = prepared.command, listener = randomUUID(), later = new Date(Date.now() + 600_000);
  await f.db.insert(nativeLiveRuntimeListenerLeases).values({ userId: f.input.userId, dispatchTarget: 'claude_code', listenerInstanceId: listener, leaseExpiresAt: later });
  await f.db.update(nativeLiveTurnPreparations).set({ dispatchStatus: 'executing', executionStartedAt: new Date(), reservedBy: listener,
    reservedAt: new Date(), reservationExpiresAt: later }).where(eq(nativeLiveTurnPreparations.id, command.prepare_id));
  const { bindNativeLiveInput } = await import('../src/domains/bridge/relay/native-live-input-binding.js');
  const admission = { userId: f.input.userId, listenerInstanceId: listener, reservationId: command.prepare_id, requestId: command.request_id,
    conversationId: f.input.conversationId, runtimeMode: 'resume' as const, canonicalUserMessageId: command.canonical_user_message_id,
    parentProviderSessionId: f.input.sessionId, parentProviderCheckpointId: desktopCheckpoint };
  for (const phase of ['queued', 'started'] as const) assert.deepEqual(await bindNativeLiveInput(f.db, { ...admission, phase }),
    { userMessageId: command.canonical_user_message_id, parentProviderCheckpointId: desktopCheckpoint });
}));

test('racing initial attachment and lost-ack retries create one empty conversation without duplicate messages', { skip: !enabled }, async () => fixture(async f => {
  const results = await Promise.all([f.attach(), f.attach()]);
  assert.deepEqual(results.map(r => r.outcome).sort(), ['already_current', 'attached']);
  assert.equal(await f.count(), 0);
  const { listNativeSessionSwitchChoices, readNativeSessionRestoreState } = await import('../src/domains/conversation/native-session-history-repository.js');
  const choices = await listNativeSessionSwitchChoices(f.db, { userId: f.input.userId });
  assert.equal(choices.conversations.length, 1);
  assert.equal(choices.conversations[0].providerSessionId, f.input.sessionId);
  assert.equal(choices.conversations[0].providerCheckpointId, f.input.checkpointId);
  await assert.rejects(readNativeSessionRestoreState(f.db, f.input), { code: 'NATIVE_SOURCE_BINDING_REQUIRED' });
}));

test('lost release response cannot reclaim ownership after a newer attach with an unchanged native file (ABA fence)', { skip: !enabled }, async () => fixture(async f => {
  await f.attach();
  const first = await f.state();
  const release = { ...f.input, expectedRevision: first.expectedRevision, checkpointIds: [f.input.checkpointId], completedTurnCheckpointIds: [f.input.checkpointId] };
  await f.releaseWithBegin(f.db, release); // ack lost
  const desktop = await f.state();
  assert.notEqual(desktop.expectedRevision, first.expectedRevision);
  const reacquire = { ...release, expectedRevision: desktop.expectedRevision };
  await f.api.attachNativeContinuation(f.db, reacquire);
  await assert.rejects(f.api.releaseNativeContinuation(f.db, release), { code: 'STALE_NATIVE_PROJECTION' });
  assert.equal((await f.state()).owner, 'leileios');
  const current = await f.state();
  await f.releaseWithBegin(f.db, { ...release, expectedRevision: current.expectedRevision });
  await assert.rejects(f.api.attachNativeContinuation(f.db, reacquire), { code: 'STALE_NATIVE_PROJECTION' });
  assert.equal((await f.state()).owner, 'desktop');
}));

test('an ordinary new conversation admits and renews its first send while the head still waits at the parent', { skip: !enabled }, async () => fixture(async f => {
  const { DrizzleNativeLiveConversationRepository } = await import('../src/domains/conversation/native-live-conversation-repository.js');
  const { checkNativeLiveExecutionAdmission } = await import('../src/domains/bridge/relay/native-live-execution-admission.js');
  const { renewNativeLiveExecutionLease } = await import('../src/domains/bridge/relay/native-live-execution-lease.js');
  const conversation = await new DrizzleNativeLiveConversationRepository(f.db).createConversation({ userId: f.input.userId });
  const port = new DrizzleNativeLiveBackendTurnPort(f.db);
  const listener = randomUUID(), later = new Date(Date.now() + 600_000);
  await f.db.insert(nativeLiveRuntimeListenerLeases).values({ userId: f.input.userId, dispatchTarget: 'claude_code', listenerInstanceId: listener, leaseExpiresAt: later });
  const prepared = await port.prepareSend({ prepareId: randomUUID(), userId: f.input.userId, requestId: randomUUID(), conversationId: conversation.id, expectedHeadMessageId: null, text: 'synthetic first input', attachmentIds: [], executionSelection: null });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const [p] = await f.db.execute(sql`SELECT * FROM native_live_turn_preparations WHERE conversation_id = ${conversation.id}::uuid`);
  assert.equal(p.runtime_mode, 'new');
  await f.db.update(nativeLiveTurnPreparations).set({ dispatchStatus: 'executing', executionStartedAt: new Date(), reservedBy: listener,
    reservedAt: new Date(), reservationExpiresAt: later }).where(eq(nativeLiveTurnPreparations.id, p.id));
  const admission = { userId: f.input.userId, listenerInstanceId: listener, reservationId: p.id, requestId: p.request_id,
    conversationId: conversation.id, runtimeMode: 'new' as const, canonicalUserMessageId: p.canonical_user_message_id,
    parentProviderSessionId: null, parentProviderCheckpointId: null };
  assert.equal(await checkNativeLiveExecutionAdmission(f.db, admission), true);
  assert.equal(await renewNativeLiveExecutionLease(f.db, admission), true);
  // Another conversation's message is never this turn's canonical input.
  assert.equal(await checkNativeLiveExecutionAdmission(f.db, { ...admission, canonicalUserMessageId: randomUUID() }), false);
}));

test('explicit continuation can recover only the current closed failed native input without importing or rewriting messages', {skip:!enabled},async()=>fixture(async f=>{
 await f.attach();const coordinator=new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(f.db));
 const prepared=await coordinator.prepare(f.input.userId,{dispatch_target:'claude_code',request_id:randomUUID(),operation:'send',conversation_id:f.input.conversationId,expected_head_message_id:null,text:'synthetic failed input'});
 assert.ok(prepared.ok);const cmd=prepared.command;
 await f.db.update(nativeLiveTurnPreparations).set({dispatchStatus:'executing',executionStartedAt:new Date(),reservedBy:randomUUID(),reservedAt:new Date(),reservationExpiresAt:new Date(Date.now()+60000)}).where(eq(nativeLiveTurnPreparations.id,cmd.prepare_id));
 const failed=await coordinator.finalize(f.input.userId,{protocol_version:4,prepare_id:cmd.prepare_id,request_id:cmd.request_id,conversation_id:cmd.conversation_id,status:'failure',error_code:'RUNTIME_UNAVAILABLE'});assert.equal(failed.ok,false);assert.equal(failed.code,'RUNTIME_UNAVAILABLE');
 await f.db.update(nativeLiveTurnPreparations).set({dispatchStatus:'completed'}).where(eq(nativeLiveTurnPreparations.id,cmd.prepare_id));
 const state=await f.state();assert.deepEqual(state.recoverableFailedTurn,{prepareId:cmd.prepare_id,userMessageId:cmd.canonical_user_message_id});
 const cp=randomUUID(),request={checkpointId:cp,revision:rev(52),expectedRevision:state.expectedRevision,checkpointIds:[cp,cmd.canonical_user_message_id,f.input.checkpointId],completedTurnCheckpointIds:[cp],recoveredFailedTurnId:cmd.prepare_id};
 await assert.rejects(f.attach({...request,recoveredFailedTurnId:randomUUID()}),{code:'CANONICAL_CHECKPOINT_CHANGED'});
 await assert.rejects(f.attach({...request,checkpointIds:[cp,f.input.checkpointId]}),{code:'CANONICAL_CHECKPOINT_CHANGED'});
 const before=await f.count();assert.equal((await f.attach(request)).outcome,'attached');assert.equal(await f.count(),before,'recovery changes continuation only; failure and old history remain intact');assert.equal((await f.state()).providerCheckpointId,cp);
 const [row]=await f.db.select().from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id,cmd.prepare_id));assert.equal(row.status,'finalized_failure');
 const next=await coordinator.prepare(f.input.userId,{dispatch_target:'claude_code',request_id:randomUUID(),operation:'send',conversation_id:cmd.conversation_id,expected_head_message_id:null,text:'synthetic subsequent input'});assert.ok(next.ok);if(next.ok)assert.equal(next.command.parent_provider_checkpoint_id,cp);
}));

for(const mode of ['later-turn','interrupted','stale-revision','foreign-user','conflicting-recovery','background-pending'] as const)test(`manual failed continuation recovery fences ${mode}`,{skip:!enabled},async()=>fixture(async f=>{
 await f.attach();const coordinator=new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(f.db));
 const prepared=await coordinator.prepare(f.input.userId,{dispatch_target:'claude_code',request_id:randomUUID(),operation:'send',conversation_id:f.input.conversationId,expected_head_message_id:null,text:'synthetic input'});assert.ok(prepared.ok);const cmd=prepared.command;
 await f.db.update(nativeLiveTurnPreparations).set({dispatchStatus:'executing',executionStartedAt:new Date(),reservedBy:randomUUID(),reservedAt:new Date(),reservationExpiresAt:new Date(Date.now()+60000)}).where(eq(nativeLiveTurnPreparations.id,cmd.prepare_id));
 const failure=await coordinator.finalize(f.input.userId,{protocol_version:4,prepare_id:cmd.prepare_id,request_id:cmd.request_id,conversation_id:cmd.conversation_id,status:'failure',error_code:mode==='interrupted'?'INTERRUPTED':'RUNTIME_UNAVAILABLE'});assert.equal(failure.ok,false);
 await f.db.update(nativeLiveTurnPreparations).set({dispatchStatus:'completed'}).where(eq(nativeLiveTurnPreparations.id,cmd.prepare_id));
 const state=await f.state(),cp=randomUUID(),request={checkpointId:cp,revision:rev(87),expectedRevision:state.expectedRevision,checkpointIds:[cp,cmd.canonical_user_message_id,f.input.checkpointId],completedTurnCheckpointIds:[cp],recoveredFailedTurnId:cmd.prepare_id};
 if(mode==='background-pending'){
  await f.db.insert(nativeLiveRuntimeEvents).values({userId:f.input.userId,prepareId:cmd.prepare_id,sequence:1000,eventType:'runtime',payload:{kind:'persistent_background_receipt_v1',phase:'queued'}});
  await assert.rejects(f.attach(request),{code:'NATIVE_CONVERSATION_BUSY'});
 }else if(mode==='later-turn'){
  assert.ok((await coordinator.prepare(f.input.userId,{dispatch_target:'claude_code',request_id:randomUUID(),operation:'send',conversation_id:cmd.conversation_id,expected_head_message_id:null,text:'synthetic newer input'})).ok);
  assert.equal((await f.state()).recoverableFailedTurn,undefined);await assert.rejects(f.attach(request),{code:'NATIVE_CONVERSATION_BUSY'});
 }else if(mode==='interrupted'){assert.equal(state.recoverableFailedTurn,undefined);await assert.rejects(f.attach(request),{code:'CANONICAL_CHECKPOINT_CHANGED'});
 }else if(mode==='stale-revision'){await assert.rejects(f.attach({...request,expectedRevision:rev(99)}),{code:'STALE_NATIVE_PROJECTION'});
 }else if(mode==='foreign-user'){await assert.rejects(f.api.attachNativeContinuation(f.db,{...f.input,...request,userId:randomUUID()}),{code:'NATIVE_CONVERSATION_NOT_FOUND'});
 }else{
  const other=randomUUID();const outcomes=await Promise.allSettled([f.attach(request),f.attach({...request,checkpointId:other,checkpointIds:[other,cmd.canonical_user_message_id,f.input.checkpointId],completedTurnCheckpointIds:[other]})]);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(outcomes.filter(o=>o.status==='rejected').length,1);
 }
}));
