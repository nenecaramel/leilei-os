import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages, nativeLiveTurnPreparations, nativeLiveRuntimeEvents, nativeLiveRuntimeListenerLeases, conversationProviderSessionCheckpoints } from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveBackendRelayRepository } from "../src/domains/bridge/relay/native-live-backend-relay.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { DrizzleNativeLiveCurrentPathReader } from "../src/domains/conversation/native-live-current-path-read-repository.js";

const enabled = process.env.RUN_NATIVE_LIVE_RELAY_DATABASE_TEST === "1";
async function fixture(t: test.TestContext) {
  const url = process.env.DATABASE_URL; assert.ok(url);
  const { isolatedPostgresTarget, verifyIsolatedPostgresTarget } = await import("../scripts/isolated-postgres-target.mjs");
  await verifyIsolatedPostgresTarget(isolatedPostgresTarget(url));
  const database = createDatabase(url, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `background-receipt-${crypto.randomUUID()}@example.com`, displayName: "Synthetic background" }).returning();
  t.after(async () => { try { await database.db.delete(nativeLiveRuntimeListenerLeases).where(eq(nativeLiveRuntimeListenerLeases.userId, user.id)); await database.db.delete(conversations).where(eq(conversations.userId, user.id)); await database.db.delete(users).where(eq(users.id, user.id)); } finally { await database.close(); } });
  const canonical = new DrizzleNativeLiveConversationRepository(database.db), conversation = await canonical.createConversation({ userId: user.id });
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
  const source = await coordinator.prepare(user.id, { dispatch_target: "claude_code", request_id: crypto.randomUUID(), conversation_id: conversation.id, operation: "send", expected_head_message_id: null, text: "synthetic" });
  assert.ok(source.ok); if (!source.ok) throw Error("source prepare failed");
  const listenerInstanceId = crypto.randomUUID(), generationId = crypto.randomUUID(), receiptId = crypto.randomUUID(), base = crypto.randomUUID(), next = crypto.randomUUID();
  const deadline = new Date(Date.now() + 600_000);
  await database.db.insert(nativeLiveRuntimeListenerLeases).values({ userId: user.id, listenerInstanceId, dispatchTarget: "claude_code", leaseExpiresAt: deadline });
  await database.db.update(nativeLiveTurnPreparations).set({ reservedBy: listenerInstanceId, reservedAt: new Date(), reservationExpiresAt: deadline, executionStartedAt: new Date(), dispatchStatus: "executing" }).where(eq(nativeLiveTurnPreparations.id, source.command.prepare_id));
  const completed = await coordinator.finalize(user.id, { protocol_version: 4, prepare_id: source.command.prepare_id, request_id: source.command.request_id, conversation_id: conversation.id, status: "success", provider_session_id: "synthetic-session", provider_checkpoint_id: base, effective_working_directory: "/synthetic", normalized_events: [{ type: "text", payload: { text: "foreground synthetic" } }] });
  assert.ok(completed.ok && completed.outcome === "completed"); if (!completed.ok || completed.outcome !== "completed") throw Error("source completion failed");
  const repository = new DrizzleNativeLiveBackendRelayRepository(database.db);
  await repository.markCompleted({ userId: user.id, listenerInstanceId, reservationId: source.command.prepare_id });
  const prepare = { userId: user.id, sourcePrepareId: source.command.prepare_id, listenerInstanceId, generationId, receiptId, parentProviderCheckpointId: base };
  const result = { protocol_version: 4 as const, prepare_id: source.command.prepare_id, request_id: source.command.request_id, conversation_id: conversation.id, status: "success" as const, provider_session_id: "synthetic-session", provider_checkpoint_id: next, effective_working_directory: "/synthetic", normalized_events: [{ type: "text", payload: { text: "background synthetic" } }] };
  const submit = { userId: user.id, sourcePrepareId: source.command.prepare_id, listenerInstanceId, generationId, receiptId, result };
  const parent = async () => {
    const prepared = await coordinator.prepare(user.id, { dispatch_target: "claude_code", request_id: crypto.randomUUID(), conversation_id: conversation.id, operation: "send", expected_head_message_id: completed.assistantMessageId, text: "next synthetic" });
    assert.ok(prepared.ok); if (!prepared.ok) throw Error("send failed"); return prepared.command.parent_provider_checkpoint_id;
  };
  return { database, user, canonical, coordinator, conversation, repository, source, completed, base, next, prepare, submit, parent };
}


test("committed background reply reaches current-path reads exactly once across reopen, delta and pagination", { skip: !enabled }, async t => {
  const f = await fixture(t);
  const reader = new DrizzleNativeLiveCurrentPathReader(f.database.db);
  const read = (options: { afterMessageId?: string; beforeMessageId?: string } = {}) =>
    reader.readCurrentPath({ userId: f.user.id, conversationId: f.conversation.id, limit: 100, ...options });
  await f.repository.prepareBackgroundResult(f.prepare);
  assert.deepEqual((await read())?.backgroundResults, [], "prepared result is never published");
  assert.deepEqual((await f.repository.submitBackgroundResult(f.submit)).outcome, "committed");
  const first = await read();
  assert.equal(first?.messages.length, 2, "background receipt is not a canonical provider turn");
  assert.deepEqual(first?.backgroundResults.map(row => [row.id, row.sourceMessageId, row.text]),
    [[f.prepare.receiptId, f.completed.assistantMessageId, "background synthetic"]]);
  const delta = await read({ afterMessageId: f.completed.assistantMessageId });
  assert.deepEqual(delta?.messages, [], "unchanged head has no new canonical messages");
  assert.deepEqual(delta?.backgroundResults, first?.backgroundResults, "background result still reaches unchanged-head delta reads");
  assert.deepEqual((await read({ beforeMessageId: f.completed.assistantMessageId }))?.backgroundResults, [],
    "older pages do not replay latest background deliveries");
  assert.deepEqual((await f.repository.submitBackgroundResult(f.submit)).duplicate, true);
  assert.deepEqual((await read())?.backgroundResults, first?.backgroundResults, "reopened chat does not double-deliver");
  const [sourceUser] = await f.database.db.select({ id: conversationMessages.id })
    .from(conversationMessages).where(eq(conversationMessages.conversationId, f.conversation.id))
    .orderBy(conversationMessages.createdAt).limit(1);
  await f.database.db.update(conversations).set({ currentHeadMessageId: sourceUser!.id })
    .where(eq(conversations.id, f.conversation.id));
  assert.deepEqual((await read())?.backgroundResults, [], "retired assistant branch cannot leak the receipt");
});

test("background commit has its own durable receipt and does not rewrite canonical foreground history", { skip: !enabled }, async t => {
  const f = await fixture(t);
  const sourceBefore = await f.database.db.select().from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, f.prepare.sourcePrepareId));
  const prepared = await f.repository.prepareBackgroundResult(f.prepare); assert.equal(prepared.receiptId, f.prepare.receiptId);
  const committed = await f.repository.submitBackgroundResult(f.submit);
  assert.deepEqual(committed, { outcome: "committed", duplicate: false, providerCheckpointId: f.next });
  assert.deepEqual(await f.database.db.select().from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, f.prepare.sourcePrepareId)), sourceBefore);
  const messages = await f.database.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, f.conversation.id)); assert.equal(messages.length, 2);
  assert.equal((await f.canonical.getConversation({ userId: f.user.id, conversationId: f.conversation.id }))!.currentHeadMessageId, f.completed.assistantMessageId);
  const cp = await f.canonical.getProviderCheckpointForHead({ userId: f.user.id, conversationId: f.conversation.id, canonicalMessageId: f.completed.assistantMessageId }); assert.equal(cp!.providerCheckpointId, f.base);
  assert.deepEqual(cp!.runtimeMetadata?.native_live_generation, { presentation_owner_id: f.prepare.sourcePrepareId, source_revision: null }, "checkpoint must carry the current server generation");
  const receipt = await f.database.db.select().from(nativeLiveRuntimeEvents).where(eq(nativeLiveRuntimeEvents.id, f.prepare.receiptId)); assert.equal(receipt.length, 1); assert.equal(receipt[0]!.eventType, "runtime");
  assert.equal(await f.parent(), f.next);
});

test("lost responses can retry preparation and commit without advancing twice", { skip: !enabled }, async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.repository.prepareBackgroundResult(f.prepare), await f.repository.prepareBackgroundResult(f.prepare));
  await f.repository.submitBackgroundResult(f.submit);
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit), { outcome: "committed", duplicate: true, providerCheckpointId: f.next });
  await assert.rejects(f.repository.submitBackgroundResult({ ...f.submit, result: { ...f.submit.result, provider_checkpoint_id: crypto.randomUUID() } }), { code: "BACKGROUND_CONFLICT" });
  assert.equal(await f.parent(), f.next);
});

for (const mutation of ["foreground", "desktop", "head", "generation", "revision", "expired-listener"] as const) test(`background receipt cannot commit after ${mutation} changes`, { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  if (mutation === "foreground") assert.equal(await f.parent(), f.base);
  else if (mutation === "expired-listener") await f.database.db.update(nativeLiveRuntimeListenerLeases).set({ leaseExpiresAt: new Date(0) }).where(eq(nativeLiveRuntimeListenerLeases.userId, f.user.id));
  else if (mutation === "head") await f.database.db.update(conversations).set({ currentHeadMessageId: null }).where(eq(conversations.id, f.conversation.id));
  else await f.database.db.execute(mutation === "generation"
    ? sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata, '{native_live_presentation_owner}', jsonb_build_object('prepareId', ${crypto.randomUUID()}::text)) WHERE id=${f.conversation.id}::uuid`
    : mutation === "revision" ? sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata, '{nativeSessionSource}', '{"owner":"leileios","revision":"changed"}'::jsonb) WHERE id=${f.conversation.id}::uuid`
      : sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata, '{nativeSessionSource}', '{"owner":"desktop"}'::jsonb) WHERE id=${f.conversation.id}::uuid`);
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit), { outcome: "stale", duplicate: false, providerCheckpointId: null });
  const [receipt] = await f.database.db.select().from(nativeLiveRuntimeEvents).where(eq(nativeLiveRuntimeEvents.id, f.prepare.receiptId));
  assert.equal(receipt!.payload?.result, undefined, "stale background content must be discarded, not attached to a retired branch");
  const cp = await f.canonical.getProviderCheckpointForHead({ userId: f.user.id, conversationId: f.conversation.id, canonicalMessageId: f.completed.assistantMessageId }); assert.equal(cp!.runtimeMetadata?.native_live_resume_tail, undefined);
});

test("another user's or another listener's receipt is never accessible", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  await assert.rejects(f.repository.submitBackgroundResult({ ...f.submit, userId: crypto.randomUUID() }), { code: "BACKGROUND_NOT_FOUND" });
  await assert.rejects(f.repository.submitBackgroundResult({ ...f.submit, listenerInstanceId: crypto.randomUUID() }), { code: "BACKGROUND_CONFLICT" });
  await assert.rejects(f.repository.submitBackgroundResult({ ...f.submit, generationId: crypto.randomUUID() }), { code: "BACKGROUND_CONFLICT" });
});

test("parallel identical completion commits at most once", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  const results = await Promise.all([f.repository.submitBackgroundResult(f.submit), f.repository.submitBackgroundResult(f.submit)]);
  assert.equal(results.filter(value => !value.duplicate).length, 1); assert.ok(results.every(value => value.outcome === "committed"));
  assert.equal(await f.parent(), f.next);
});

test("a second receipt from the old parent cannot overwrite the first committed result", { skip: !enabled }, async t => {
  const f = await fixture(t), second = crypto.randomUUID();
  await f.repository.prepareBackgroundResult(f.prepare); await f.repository.prepareBackgroundResult({ ...f.prepare, receiptId: second });
  await f.repository.submitBackgroundResult(f.submit);
  assert.equal((await f.repository.submitBackgroundResult({ ...f.submit, receiptId: second, result: { ...f.submit.result, provider_checkpoint_id: crypto.randomUUID() } })).outcome, "stale");
  assert.equal(await f.parent(), f.next);
});

test("failed background result is recorded idempotently without advancing native cursor", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  const input = { ...f.submit, result: { protocol_version: 4 as const, prepare_id: f.prepare.sourcePrepareId, request_id: f.source.command.request_id, conversation_id: f.conversation.id, status: "failure" as const, error_code: "CLAUDE_PROCESS_FAILED" as const } };
  assert.deepEqual(await f.repository.submitBackgroundResult(input), { outcome: "failed", duplicate: false, providerCheckpointId: null });
  assert.deepEqual(await f.repository.submitBackgroundResult(input), { outcome: "failed", duplicate: true, providerCheckpointId: null });
  assert.equal(await f.parent(), f.base);
});

test("wrong session, cwd, attachment or source identity cannot be committed", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  for (const patch of [{ provider_session_id: "wrong" }, { effective_working_directory: "/wrong" }, { prepare_id: crypto.randomUUID() }, { output_attachment_ids: [crypto.randomUUID()] }]) await assert.rejects(f.repository.submitBackgroundResult({ ...f.submit, result: { ...f.submit.result, ...patch } }));
  assert.equal((await f.repository.submitBackgroundResult(f.submit)).outcome, "committed");
});

test("authenticated HTTP background preparation and submission return the durable independent receipt", { skip: !enabled }, async t => {
  const f = await fixture(t);
  const { withServer } = await import("./helpers/native-live-http-relay-fixtures.js");
  const { createNativeLiveRelayInternalRouter } = await import("../src/web-api/native-live-relay-internal-router.js");
  const { NativeLiveBackendRelayService } = await import("../src/domains/bridge/relay/native-live-backend-relay.js");
  const service = new NativeLiveBackendRelayService(f.repository, f.coordinator);
  await withServer(app => {
    app.use((request, _response, next) => { request.mcpUserId = f.user.id; next(); });
    app.use("/relay", createNativeLiveRelayInternalRouter({ relayService: service }));
  }, async baseUrl => {
    const prepare = await fetch(`${baseUrl}/relay/reservations/${f.prepare.sourcePrepareId}/background-results/prepare`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt_id: f.prepare.receiptId, listener_instance_id: f.prepare.listenerInstanceId, generation_id: f.prepare.generationId, parent_provider_checkpoint_id: f.base }),
    });
    assert.equal(prepare.status, 200); assert.equal((await prepare.json() as { data: { receiptId: string } }).data.receiptId, f.prepare.receiptId);
    const url = `${baseUrl}/relay/reservations/${f.prepare.sourcePrepareId}/background-results/${f.prepare.receiptId}/result`;
    const body = JSON.stringify({ listener_instance_id: f.submit.listenerInstanceId, generation_id: f.submit.generationId, result: f.submit.result });
    const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(first.status, 200); assert.deepEqual((await first.json() as { data: unknown }).data, { outcome: "committed", duplicate: false, providerCheckpointId: f.next });
    const retry = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(retry.status, 200); assert.deepEqual((await retry.json() as { data: unknown }).data, { outcome: "committed", duplicate: true, providerCheckpointId: f.next });
  });
});


test("a prepared receipt expires closed, while committed receipt retries preserve their original outcome", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  await f.database.db.execute(sql`UPDATE native_live_runtime_events SET payload=jsonb_set(payload,'{expiresAt}','"2000-01-01T00:00:00.000Z"'::jsonb) WHERE id=${f.prepare.receiptId}::uuid`);
  assert.equal((await f.repository.submitBackgroundResult(f.submit)).outcome, "stale");
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit), { outcome: "stale", duplicate: true, providerCheckpointId: null });
  assert.equal(await f.parent(), f.base);
});

test("terminal receipt remains idempotent after head and lease changes without rewriting cursor", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare); await f.repository.submitBackgroundResult(f.submit);
  await f.parent(); await f.database.db.update(nativeLiveRuntimeListenerLeases).set({ leaseExpiresAt: new Date(0) }).where(eq(nativeLiveRuntimeListenerLeases.userId, f.user.id));
  const before = await f.database.db.select().from(conversationProviderSessionCheckpoints).where(eq(conversationProviderSessionCheckpoints.conversationId, f.conversation.id));
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit), { outcome: "committed", duplicate: true, providerCheckpointId: f.next });
  assert.deepEqual(await f.database.db.select().from(conversationProviderSessionCheckpoints).where(eq(conversationProviderSessionCheckpoints.conversationId, f.conversation.id)), before);
});

test("a source without server generation evidence cannot acquire a new background receipt", { skip: !enabled }, async t => {
  const f = await fixture(t);
  await f.database.db.execute(sql`UPDATE conversation_provider_session_checkpoints SET runtime_metadata=runtime_metadata-'native_live_generation' WHERE conversation_id=${f.conversation.id}::uuid`);
  await assert.rejects(f.repository.prepareBackgroundResult(f.prepare), { code: "BACKGROUND_CONFLICT" });
  assert.equal((await f.database.db.select().from(nativeLiveRuntimeEvents).where(eq(nativeLiveRuntimeEvents.id, f.prepare.receiptId))).length, 0);
});

// Observe a real PostgreSQL lock boundary instead of assuming a timer overlaps
// the commit transaction. Each connection is named only for this synthetic test.
for (const competitor of ["lease takeover", "head rotation", "second receipt"] as const) test(`background commit fences overlapping ${competitor}`, { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  const otherReceipt = crypto.randomUUID(), otherCheckpoint = crypto.randomUUID();
  if (competitor === "second receipt") await f.repository.prepareBackgroundResult({ ...f.prepare, receiptId: otherReceipt });
  const { default: postgres } = await import("postgres");
  const prefix = `bg-${crypto.randomUUID()}`;
  const named = (suffix: string) => createDatabase(process.env.DATABASE_URL!, {
    createClient: url => postgres(url, { max: 1, ssl: false, prepare: false, connection: { application_name: `${prefix}-${suffix}` } }),
  });
  const committing = named("commit"), competing = named("compete");
  t.after(async () => { await committing.close(); await competing.close(); });
  let release!: () => void, locked!: () => void;
  const releaseGate = new Promise<void>(resolve => { release = resolve; });
  const lockedGate = new Promise<void>(resolve => { locked = resolve; });
  const blocker = f.database.db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM conversation_provider_session_checkpoints WHERE conversation_id=${f.conversation.id}::uuid FOR UPDATE`);
    locked(); await releaseGate;
  });
  const waitForLock = async (suffix: string) => {
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      const rows = await f.database.db.execute(sql`SELECT 1 FROM pg_stat_activity WHERE application_name=${`${prefix}-${suffix}`} AND wait_event_type='Lock'`);
      if (rows.length) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`expected ${suffix} to reach an observable database lock`);
  };
  let commit: Promise<unknown> | undefined, competingWork: Promise<unknown> | undefined;
  try {
    await lockedGate;
    commit = new DrizzleNativeLiveBackendRelayRepository(committing.db).submitBackgroundResult(f.submit);
    await waitForLock("commit");
    competingWork = competitor === "lease takeover"
      ? competing.db.update(nativeLiveRuntimeListenerLeases).set({ listenerInstanceId: crypto.randomUUID() }).where(eq(nativeLiveRuntimeListenerLeases.userId, f.user.id)).execute()
      : competitor === "head rotation"
        ? competing.db.update(conversations).set({ currentHeadMessageId: null }).where(eq(conversations.id, f.conversation.id)).execute()
        : new DrizzleNativeLiveBackendRelayRepository(competing.db).submitBackgroundResult({ ...f.submit, receiptId: otherReceipt, result: { ...f.submit.result, provider_checkpoint_id: otherCheckpoint } });
    await waitForLock("compete");
    release(); await blocker;
    assert.deepEqual(await commit, { outcome: "committed", duplicate: false, providerCheckpointId: f.next });
    const other = await competingWork;
    if (competitor === "second receipt") assert.deepEqual(other, { outcome: "stale", duplicate: false, providerCheckpointId: null });
    const [cp] = await f.database.db.select().from(conversationProviderSessionCheckpoints).where(eq(conversationProviderSessionCheckpoints.conversationId, f.conversation.id));
    assert.equal((cp!.runtimeMetadata?.native_live_resume_tail as { checkpoint_id: string }).checkpoint_id, f.next);
    assert.deepEqual(await f.repository.submitBackgroundResult(f.submit), { outcome: "committed", duplicate: true, providerCheckpointId: f.next });
  } finally {
    release(); await blocker;
    await Promise.allSettled([commit, competingWork].filter((value): value is Promise<unknown> => Boolean(value)));
  }
});
