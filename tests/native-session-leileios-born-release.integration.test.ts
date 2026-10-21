import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from '../src/database/client.js';
import { users, conversations, conversationProviderSessionCheckpoints as checkpoints,
  nativeLiveRuntimeListenerLeases as leases, nativeLiveTurnPreparations as preparations } from '../src/database/schema.js';
import { DrizzleNativeLiveBackendTurnPort } from '../src/domains/bridge/turn/native-live-backend-turn-repository.js';
import { NativeLiveBackendTurnCoordinator } from '../src/domains/bridge/turn/native-live-backend-turn-coordinator.js';
import { DrizzleNativeLiveConversationRepository } from '../src/domains/conversation/native-live-conversation-repository.js';
import { NativeLiveConversationService } from '../src/domains/conversation/native-live-conversation-service.js';
import { readNativeSessionOwner } from '../src/domains/bridge/turn/turn-repository/session-owner.js';
import { attachNativeContinuation, beginNativeContinuationRelease, cancelNativeContinuationRelease,
  readNativeContinuationState, releaseNativeContinuation } from '../src/domains/conversation/native-session-continuation-repository.js';

// A conversation created in LeileiOS has no Desktop binding. Continuation-only
// switching must still hand its head session to Desktop and take it back.
const enabled = process.env.RUN_NATIVE_SESSION_PRESERVATION_DATABASE_TEST === '1';
const cwd = '/synthetic/leileios-born';

async function fixture(run: (f: { db: ReturnType<typeof createDatabase>['db']; userId: string }) => Promise<void>) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/leileios_native_session_test');
  const database = createDatabase(url.href, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `born-${randomUUID()}@example.com`, displayName: 'Synthetic born' }).returning();
  try { await run({ db: database.db, userId: user!.id }); }
  finally {
    await database.db.delete(leases).where(eq(leases.userId, user!.id));
    await database.db.delete(conversations).where(eq(conversations.userId, user!.id));
    await database.db.delete(users).where(eq(users.id, user!.id));
    await database.close();
  }
}

async function completeTurn(db: ReturnType<typeof createDatabase>['db'], userId: string, conversationId: string, head: string | null) {
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(db));
  const prepared = await coordinator.prepare(userId, { dispatch_target: 'claude_code', request_id: randomUUID(),
    conversation_id: conversationId, operation: 'send', expected_head_message_id: head, text: 'synthetic input' });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  if (!prepared.ok) throw Error('prepare failed');
  const command = prepared.command, listener = randomUUID(), later = new Date(Date.now() + 600_000);
  await db.delete(leases).where(eq(leases.userId, userId));
  await db.insert(leases).values({ userId, dispatchTarget: 'claude_code', listenerInstanceId: listener, leaseExpiresAt: later });
  await db.update(preparations).set({ dispatchStatus: 'executing', executionStartedAt: new Date(), reservedBy: listener,
    reservedAt: new Date(), reservationExpiresAt: later }).where(eq(preparations.id, command.prepare_id));
  const session = command.runtime_mode === 'resume' ? command.parent_provider_session_id! : randomUUID();
  const checkpoint = randomUUID();
  const done = await coordinator.finalize(userId, { protocol_version: 4, prepare_id: command.prepare_id, request_id: command.request_id,
    conversation_id: conversationId, status: 'success', provider_session_id: session, provider_checkpoint_id: checkpoint,
    effective_working_directory: cwd, normalized_events: [{ type: 'text', payload: { text: 'synthetic reply' } }] });
  assert.ok(done.ok && done.outcome === 'completed', JSON.stringify(done));
  await db.update(preparations).set({ dispatchStatus: 'completed' }).where(eq(preparations.id, command.prepare_id));
  return { session, checkpoint, head: (done as { assistantMessageId: string }).assistantMessageId };
}

test('a LeileiOS-born conversation releases to Desktop, cancels, and attaches back', { skip: !enabled }, async () => fixture(async ({ db, userId }) => {
  const conversation = await new NativeLiveConversationService(new DrizzleNativeLiveConversationRepository(db))
    .createConversation({ userId, title: 'Born in LeileiOS' });
  const first = await completeTurn(db, userId, conversation.id, null);
  const [before] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
  assert.equal(before!.providerMetadata.nativeSessionSource, undefined, 'never bound from Desktop');

  const state = await readNativeContinuationState(db, { userId, conversationId: conversation.id, sessionId: first.session });
  assert.equal(state.providerSessionId, first.session);
  assert.equal(state.providerCheckpointId, first.checkpoint);
  const release = { userId, conversationId: conversation.id, sessionId: first.session, checkpointId: first.checkpoint,
    revision: 'a'.repeat(64), effectiveWorkingDirectory: cwd, expectedHeadMessageId: first.head,
    checkpointIds: [first.checkpoint], completedTurnCheckpointIds: [first.checkpoint] };

  // A failed switch rolls back to LeileiOS and the conversation keeps working.
  const cancelled = await beginNativeContinuationRelease(db, { userId, conversationId: conversation.id, sessionId: first.session,
    expectedHeadMessageId: first.head, expectedRevision: state.expectedRevision });
  assert.equal(await readNativeSessionOwner(db, { userId, conversationId: conversation.id }), 'releasing');
  await cancelNativeContinuationRelease(db, { userId, conversationId: conversation.id, expectedRevision: cancelled.expectedRevision });
  assert.equal(await readNativeSessionOwner(db, { userId, conversationId: conversation.id }), 'leileios');
  const second = await completeTurn(db, userId, conversation.id, first.head);

  // Hand the current head session to Desktop.
  const current = await readNativeContinuationState(db, { userId, conversationId: conversation.id, sessionId: second.session });
  const begun = await beginNativeContinuationRelease(db, { userId, conversationId: conversation.id, sessionId: second.session,
    expectedHeadMessageId: second.head, expectedRevision: current.expectedRevision });
  const released = await releaseNativeContinuation(db, { ...release, checkpointId: second.checkpoint, expectedHeadMessageId: second.head,
    expectedRevision: begun.expectedRevision, checkpointIds: [first.checkpoint, second.checkpoint], completedTurnCheckpointIds: [second.checkpoint] });
  assert.equal(released.owner, 'desktop');
  assert.equal(await readNativeSessionOwner(db, { userId, conversationId: conversation.id }), 'desktop');
  const port = new DrizzleNativeLiveBackendTurnPort(db);
  const refused = await port.prepareSend({ prepareId: randomUUID(), userId, requestId: randomUUID(), conversationId: conversation.id,
    expectedHeadMessageId: second.head, text: 'while on Desktop', attachmentIds: [], executionSelection: null });
  assert.equal(refused.ok, false);

  // Desktop added a turn; LeileiOS attaches the new native tail and continues.
  const desktopTurn = randomUUID();
  const back = await readNativeContinuationState(db, { userId, conversationId: conversation.id, sessionId: second.session });
  const attached = await attachNativeContinuation(db, { ...release, checkpointId: desktopTurn, revision: 'b'.repeat(64),
    expectedHeadMessageId: second.head, expectedRevision: back.expectedRevision,
    checkpointIds: [first.checkpoint, second.checkpoint, desktopTurn], completedTurnCheckpointIds: [desktopTurn, second.checkpoint] });
  assert.equal(attached.owner, 'leileios');
  const resumed = await port.prepareSend({ prepareId: randomUUID(), userId, requestId: randomUUID(), conversationId: conversation.id,
    expectedHeadMessageId: second.head, text: 'back in LeileiOS', attachmentIds: [], executionSelection: null });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const [p] = await db.execute<{ runtime_mode: string; parent_provider_checkpoint_id: string }>(sql`
    SELECT runtime_mode, parent_provider_checkpoint_id FROM native_live_turn_preparations
    WHERE conversation_id=${conversation.id}::uuid ORDER BY created_at DESC LIMIT 1`);
  assert.equal(p!.runtime_mode, 'resume');
  assert.equal(p!.parent_provider_checkpoint_id, desktopTurn, 'resumes the Desktop tail');
  const [cp] = await db.select().from(checkpoints).where(eq(checkpoints.canonicalMessageId, second.head));
  assert.equal(cp!.providerSessionId, second.session);
}));
