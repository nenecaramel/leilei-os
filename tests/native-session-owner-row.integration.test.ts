import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from '../src/database/client.js';
import { users, conversations, conversationMessages, conversationContentBlocks, conversationProviderSessionCheckpoints as checkpoints,
  nativeLiveRuntimeListenerLeases as leases, nativeLiveTurnPreparations as preparations } from '../src/database/schema.js';
import { DrizzleNativeLiveBackendTurnPort } from '../src/domains/bridge/turn/native-live-backend-turn-repository.js';
import { NativeLiveBackendTurnCoordinator } from '../src/domains/bridge/turn/native-live-backend-turn-coordinator.js';

// Owner/revision and the turn are row-owned; JSON copies are retired.
// The row independently owns the turn
// slot and writer generation. Prepare replaces the turn without rotating generation.
const enabled = process.env.RUN_NATIVE_SESSION_PRESERVATION_DATABASE_TEST === '1';
const rev = (n: number) => n.toString(16).padStart(64, '0');
type Db = ReturnType<typeof createDatabase>['db'];
type Row = { owner: string; owner_revision: string | null; writer_generation: string; turn_prepare_id: string | null; turn_anchor_message_id: string | null };

async function fixture(run: (f: { db: Db; userId: string }) => Promise<void>) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/leileios_native_session_test');
  assert.notEqual(process.env.NODE_ENV, 'production');
  const database = createDatabase(url.href, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `owner-row-${randomUUID()}@example.com`, displayName: 'Synthetic owner row' }).returning();
  try { await run({ db: database.db, userId: user!.id }); }
  finally {
    await database.db.delete(leases).where(eq(leases.userId, user!.id));
    await database.db.delete(conversations).where(eq(conversations.userId, user!.id));
    await database.db.delete(users).where(eq(users.id, user!.id));
    await database.close();
  }
}

async function ownerRow(db: Pick<Db, 'execute'>, conversationId: string): Promise<Row | undefined> {
  const [row] = await db.execute<Row>(sql`SELECT owner, owner_revision, writer_generation::text, turn_prepare_id::text, turn_anchor_message_id::text
    FROM native_live_session_owners WHERE conversation_id = ${conversationId}::uuid`);
  return row;
}

async function mirrored(db: Db, conversationId: string): Promise<Row> {
  const [c] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  const source = c!.providerMetadata.nativeSessionSource as { owner?: string; revision?: string } | undefined;
  assert.equal(Object.hasOwn(c!.providerMetadata, "native_live_presentation_owner"),false);
  const row = await ownerRow(db, conversationId);
  assert.ok(row, 'owner row exists');
  assert.ok(['leileios','releasing','desktop'].includes(row.owner));
  if ((c!.providerMetadata.nativeSessionSource as any)?.mode === 'continuation') {
    assert.equal(source?.owner,undefined);assert.equal(source?.revision,undefined);
    assert.match(row.owner_revision!,/^[0-9a-f]{64}$/);
  }

  return row;
}

async function execute(db: Db, userId: string, prepareId: string, listener = randomUUID()) {
  const later = new Date(Date.now() + 600_000);
  await db.delete(leases).where(eq(leases.userId, userId));
  await db.insert(leases).values({ userId, dispatchTarget: 'claude_code', listenerInstanceId: listener, leaseExpiresAt: later });
  await db.update(preparations).set({ dispatchStatus: 'executing', executionStartedAt: new Date(), reservedBy: listener,
    reservedAt: new Date(), reservationExpiresAt: later }).where(eq(preparations.id, prepareId));
  const [p] = await db.select().from(preparations).where(eq(preparations.id, prepareId));
  return p!;
}

async function finalize(db: Db, userId: string, p: typeof preparations.$inferSelect, sessionId: string) {
  return new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(db)).finalize(userId, {
    protocol_version: 4, prepare_id: p.id, request_id: p.requestId, conversation_id: p.conversationId,
    status: 'success', provider_session_id: sessionId, provider_checkpoint_id: randomUUID(),
    effective_working_directory: p.expectedWorkingDirectory ?? '/synthetic/workspace',
    normalized_events: [{ type: 'text', payload: { text: 'synthetic reply' } }],
  });
}

async function stampedGeneration(db: Db, assistantMessageId: string) {
  const [cp] = await db.select().from(checkpoints).where(eq(checkpoints.canonicalMessageId, assistantMessageId));
  return (cp!.runtimeMetadata as { native_live_generation?: { writer_generation?: string } }).native_live_generation?.writer_generation;
}

test('migration backfill maps the current JSON owner, revision and slot, seeding the generation from the slot', { skip: !enabled }, async () => fixture(async ({ db, userId }) => {
  const statements = readFileSync(new URL('../drizzle/0111_native_live_session_owners.sql', import.meta.url), 'utf8').split('--> statement-breakpoint');
  const backfill = statements.find(statement => statement.includes('INSERT INTO "native_live_session_owners"'));
  assert.ok(backfill);
  const slotted = randomUUID(), bare = randomUUID(), prepareId = randomUUID(), anchor = randomUUID();
  await db.insert(conversations).values([
    { id: slotted, userId, origin: 'native_live', providerMetadata: {
      nativeSessionSource: { owner: 'desktop', revision: rev(7) },
      native_live_presentation_owner: { prepareId, anchorHeadMessageId: anchor } } },
    { id: bare, userId, origin: 'native_live' },
  ]);
  const rollback = new Error('rollback synthetic backfill');
  await assert.rejects(db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM native_live_session_owners`);
    await tx.execute(sql.raw(backfill));
    assert.deepEqual(await ownerRow(tx, slotted), { owner: 'desktop', owner_revision: rev(7), writer_generation: prepareId,
      turn_prepare_id: prepareId, turn_anchor_message_id: anchor });
    const empty = await ownerRow(tx, bare);
    assert.equal(empty?.owner, 'leileios'); assert.equal(empty?.owner_revision, null);
    assert.match(empty?.writer_generation ?? '', /^[0-9a-f-]{36}$/); assert.equal(empty?.turn_prepare_id, null);
    throw rollback;
  }), rollback);
}));

test('switching mirrors owner/revision and sends replace the row turn; a superseded prepare and a resumed commit keep the writer generation', { skip: !enabled }, async () => fixture(async ({ db, userId }) => {
  const api = await import('../src/domains/conversation/native-session-continuation-repository.js');
  const input = { userId, conversationId: randomUUID(), sessionId: randomUUID(), checkpointId: randomUUID(), revision: rev(1),
    effectiveWorkingDirectory: '/synthetic/workspace', expectedHeadMessageId: null, expectedRevision: null,
    checkpointIds: [] as string[], completedTurnCheckpointIds: [] as string[] };
  input.checkpointIds = [input.checkpointId]; input.completedTurnCheckpointIds = [input.checkpointId];
  await api.attachNativeContinuation(db, input);
  const attached = await mirrored(db, input.conversationId);
  assert.equal(attached.owner, 'leileios');

  const port = new DrizzleNativeLiveBackendTurnPort(db);
  const send = (prepareId: string) => port.prepareSend({ prepareId, userId, requestId: randomUUID(), conversationId: input.conversationId,
    expectedHeadMessageId: null, text: 'synthetic input', attachmentIds: [], executionSelection: null });
  const first = randomUUID(), second = randomUUID();
  assert.equal((await send(first)).ok, true);
  const afterFirst = await mirrored(db, input.conversationId);
  assert.equal(afterFirst.turn_prepare_id, first);
  assert.equal(afterFirst.writer_generation, attached.writer_generation, 'prepare must not rotate the writer generation');
  await db.update(preparations).set({ dispatchStatus: 'rejected', dispatchErrorCode: 'INVALID_COMMAND' }).where(eq(preparations.id, first));
  assert.equal((await send(second)).ok, true);
  const afterSecond = await mirrored(db, input.conversationId);
  assert.equal(afterSecond.turn_prepare_id, second);
  assert.equal(afterSecond.writer_generation, attached.writer_generation, 'a superseding prepare keeps the generation');

  const completed = await finalize(db, userId, await execute(db, userId, second), input.sessionId);
  assert.equal(completed.outcome, 'completed', JSON.stringify(completed));
  const committed = await mirrored(db, input.conversationId);
  assert.equal(committed.turn_anchor_message_id,(completed as {assistantMessageId:string}).assistantMessageId);
  assert.equal(committed.turn_prepare_id,second);
  assert.equal(committed.writer_generation, attached.writer_generation, 'a resumed send continues the same native line');
  assert.equal(await stampedGeneration(db, (completed as { assistantMessageId: string }).assistantMessageId), attached.writer_generation);

  // The relay, not finalize, closes dispatch; do that here before switching out.
  await db.update(preparations).set({ dispatchStatus: 'completed' }).where(eq(preparations.id, second));
  const state = await api.readNativeContinuationState(db, input);
  const [cp] = await db.select().from(checkpoints).where(eq(checkpoints.canonicalMessageId, state.expectedHeadMessageId!));
  const releaseBegin=await api.beginNativeContinuationRelease(db,{...input,expectedHeadMessageId:state.expectedHeadMessageId,expectedRevision:state.expectedRevision});
  await api.releaseNativeContinuation(db, { ...input, checkpointId: cp!.providerCheckpointId!, revision: rev(2),
    expectedHeadMessageId: state.expectedHeadMessageId, expectedRevision: releaseBegin.expectedRevision,
    checkpointIds: [input.checkpointId, cp!.providerCheckpointId!], completedTurnCheckpointIds: [cp!.providerCheckpointId!] });
  const released = await mirrored(db, input.conversationId);
  assert.equal(released.owner, 'desktop');
  assert.equal(released.turn_prepare_id,committed.turn_prepare_id);
  assert.equal(released.turn_anchor_message_id,committed.turn_anchor_message_id);
  assert.notEqual(released.owner_revision, committed.owner_revision);
}));

test('an edit commit starts a new native line and stamps the new writer generation', { skip: !enabled }, async () => fixture(async ({ db, userId }) => {
  const conversationId = randomUUID(), parent = randomUUID(), target = randomUUID(), head = randomUUID();
  const session = randomUUID(), checkpoint = randomUUID();
  await db.insert(conversations).values({ id: conversationId, userId, origin: 'native_live' });
  await db.insert(conversationMessages).values({ id: parent, userId, conversationId, role: 'assistant', status: 'completed' });
  await db.insert(checkpoints).values({ userId, conversationId, canonicalMessageId: parent, provider: 'claude_code',
    providerSessionId: session, providerCheckpointId: checkpoint, effectiveWorkingDirectory: '/synthetic' });
  await db.insert(conversationMessages).values({ id: target, userId, conversationId, role: 'user', parentMessageId: parent, status: 'completed' });
  await db.insert(conversationContentBlocks).values({ userId, messageId: target, ordinal: 0, kind: 'text', rawType: 'text', text: 'synthetic input' });
  await db.insert(conversationMessages).values({ id: head, userId, conversationId, role: 'assistant', parentMessageId: target, status: 'completed' });
  await db.update(conversations).set({ currentHeadMessageId: head }).where(eq(conversations.id, conversationId));

  const port = new DrizzleNativeLiveBackendTurnPort(db);
  const prepareId = randomUUID();
  const prepared = await port.prepareEdit({ prepareId, userId, requestId: randomUUID(), conversationId,
    targetUserMessageId: target, executionSelection: null, text: 'synthetic replacement', attachmentIds: [] });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const before = await mirrored(db, conversationId);
  assert.equal(before.turn_prepare_id, prepareId);

  // The edit rewinds the same native session in place, yet still replaces the line.
  const completed = await finalize(db, userId, await execute(db, userId, prepareId), session);
  assert.equal(completed.outcome, 'completed', JSON.stringify(completed));
  const after = await mirrored(db, conversationId);
  assert.notEqual(after.writer_generation, before.writer_generation, 'an edit replaces the native line');
  assert.equal(await stampedGeneration(db, (completed as { assistantMessageId: string }).assistantMessageId), after.writer_generation);
}));

test('input reaching the native session rotates the generation once; queueing and later events do not', { skip: !enabled }, async () => fixture(async ({ db, userId }) => {
  const api = await import('../src/domains/conversation/native-session-continuation-repository.js');
  const { bindNativeLiveInput } = await import('../src/domains/bridge/relay/native-live-input-binding.js');
  const { DrizzleNativeLiveRuntimeEventRepository } = await import('../src/domains/bridge/runtime-interaction/native-live-runtime-event-stream.js');
  const events = new DrizzleNativeLiveRuntimeEventRepository(db);
  const port = new DrizzleNativeLiveBackendTurnPort(db);
  const generation = async (conversationId: string) => (await ownerRow(db, conversationId))!.writer_generation;

  async function sendOn(conversationId: string, sessionId: string, checkpointId: string) {
    await api.attachNativeContinuation(db, { userId, conversationId, sessionId, checkpointId, revision: rev(1),
      effectiveWorkingDirectory: '/synthetic/workspace', expectedHeadMessageId: null, expectedRevision: null,
      checkpointIds: [checkpointId], completedTurnCheckpointIds: [checkpointId] });
    const prepareId = randomUUID(), listener = randomUUID();
    assert.equal((await port.prepareSend({ prepareId, userId, requestId: randomUUID(), conversationId,
      expectedHeadMessageId: null, text: 'synthetic input', attachmentIds: [], executionSelection: null })).ok, true);
    const p = await execute(db, userId, prepareId, listener);
    return { p, listener, admission: { userId, listenerInstanceId: listener, reservationId: p.id, requestId: p.requestId,
      conversationId, runtimeMode: 'resume' as const, canonicalUserMessageId: p.canonicalUserMessageId,
      parentProviderSessionId: sessionId, parentProviderCheckpointId: checkpointId } };
  }
  const event = (sequence: number) => ({ sequence, event: { type: 'text' as const, payload: { text: `synthetic ${sequence}` } } });

  // Persistent writer: the started input binding is the boundary.
  const bound = randomUUID();
  const first = await sendOn(bound, randomUUID(), randomUUID());
  const g0 = await generation(bound);
  assert.ok(await bindNativeLiveInput(db, { ...first.admission, phase: 'queued' }));
  assert.equal(await generation(bound), g0, 'queued input has not reached the native session');
  assert.ok(await bindNativeLiveInput(db, { ...first.admission, phase: 'started' }));
  const g1 = await generation(bound);
  assert.notEqual(g1, g0, 'started input changes the native line');
  assert.ok(await bindNativeLiveInput(db, { ...first.admission, phase: 'started' }));
  await events.appendBatch({ userId, listenerInstanceId: first.listener, reservationId: first.p.id, events: [event(1)] });
  assert.equal(await generation(bound), g1, 'a repeated start and the first events after it rotate nothing');

  // Without a binding (one-shot path) the first runtime events are the boundary.
  const evented = randomUUID();
  const second = await sendOn(evented, randomUUID(), randomUUID());
  const h0 = await generation(evented);
  await events.appendBatch({ userId, listenerInstanceId: second.listener, reservationId: second.p.id, events: [event(1), event(2)] });
  const h1 = await generation(evented);
  assert.notEqual(h1, h0, 'first runtime events prove the input ran');
  await events.appendBatch({ userId, listenerInstanceId: second.listener, reservationId: second.p.id, events: [event(2), event(3)] });
  assert.equal(await generation(evented), h1, 'later and replayed events rotate nothing');
}));
