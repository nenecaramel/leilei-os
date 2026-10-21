import { syncTestNativeSessionOwner } from "./helpers/native-session-turn.js";
import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages, nativeLiveTurnPreparations, nativeLiveRuntimeEvents, nativeLiveRuntimeListenerLeases, conversationProviderSessionCheckpoints } from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveBackendRelayRepository } from "../src/domains/bridge/relay/native-live-backend-relay.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";

import { DrizzleNativeLiveRuntimeControlRepository } from "../src/domains/bridge/runtime-interaction/native-live-runtime-control.js";
const enabled = process.env.RUN_NATIVE_LIVE_TASK_STATE_DATABASE_TEST === "1";
async function fixture(t: test.TestContext) {
  const url = process.env.DATABASE_URL; assert.ok(url);
  const { isolatedPostgresTarget, verifyIsolatedPostgresTarget } = await import("../scripts/isolated-postgres-target.mjs");
  const target = isolatedPostgresTarget(url);
  assert.equal(target.database, "leileios_native_session_test");
  await verifyIsolatedPostgresTarget(target);
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


const snapshot = (f: Awaited<ReturnType<typeof fixture>>, snapshotSequence = 1, tasks: unknown[] = []) => ({ userId: f.user.id,
  prepareId: f.prepare.sourcePrepareId, listenerInstanceId: f.prepare.listenerInstanceId, providerSessionId: "synthetic-session",
  generationId: f.prepare.generationId, snapshotSequence, tasks });
const publish = (repo: DrizzleNativeLiveRuntimeControlRepository, input: ReturnType<typeof snapshot>) => (repo as any).publishTaskState(input);
const task = { task_id: "cron-1", run_id: "run-1", task_type: "cron", description: "synthetic", ambient: true };
test("task-state persists ordered replacement events without changing canonical state, and rejects conflicting retries", { skip: !enabled }, async t => {
  const f = await fixture(t), repo = new DrizzleNativeLiveRuntimeControlRepository(f.database.db);
  const before = (await f.database.db.select().from(conversations).where(eq(conversations.id, f.conversation.id)))[0];
  await f.database.db.insert(nativeLiveRuntimeEvents).values({ userId: f.user.id, prepareId: f.prepare.sourcePrepareId, sequence: 7, eventType: "runtime", payload: { phase: "foreground" } });
  assert.deepEqual(await publish(repo, snapshot(f, 2, [task])), { outcome: "created" });
  assert.deepEqual(await publish(repo, snapshot(f, 2, [task])), { outcome: "idempotent" });
  await assert.rejects(publish(repo, snapshot(f, 2, [])), { code: "CONTROL_CONFLICT" });
  assert.deepEqual(await publish(repo, snapshot(f, 1, [])), { outcome: "stale" });
  assert.deepEqual(await publish(repo, snapshot(f, 3, [])), { outcome: "created" });
  const events = await f.database.db.select().from(nativeLiveRuntimeEvents).where(eq(nativeLiveRuntimeEvents.prepareId, f.prepare.sourcePrepareId)).orderBy(nativeLiveRuntimeEvents.sequence);
  assert.deepEqual(events.map(e => [e.sequence, e.eventType, e.payload]), [[7, "runtime", { phase: "foreground" }], [8, "task", { phase: "active_set", replace: true, tasks: [task] }], [9, "task", { phase: "active_set", replace: true, tasks: [] }]]);
  assert.deepEqual((await f.database.db.select().from(conversations).where(eq(conversations.id, f.conversation.id)))[0], before);
});
test("task-state concurrent snapshots allocate unique event sequences and cannot replace newer membership", { skip: !enabled }, async t => {
  const f = await fixture(t), repo = new DrizzleNativeLiveRuntimeControlRepository(f.database.db);
  await Promise.all([publish(repo, snapshot(f, 2, [task])), publish(repo, snapshot(f, 3, [])), publish(repo, snapshot(f, 1, [task]))]);
  const events = await f.database.db.select().from(nativeLiveRuntimeEvents).where(eq(nativeLiveRuntimeEvents.prepareId, f.prepare.sourcePrepareId)).orderBy(nativeLiveRuntimeEvents.sequence);
  assert.equal(new Set(events.map(e => e.sequence)).size, events.length);
  assert.deepEqual(events.at(-1)?.payload, { phase: "active_set", replace: true, tasks: [] });
});
for (const mutation of ["wrong-user", "wrong-session", "wrong-listener", "generation", "uncommitted", "head", "expired-listener", "desktop", "branch"] as const) test(`task-state rejects ${mutation} before appending events`, { skip: !enabled }, async t => {
  const f = await fixture(t), repo = new DrizzleNativeLiveRuntimeControlRepository(f.database.db), input = snapshot(f, 2, [task]);
  if (mutation === "generation") { await publish(repo, snapshot(f)); input.generationId = crypto.randomUUID(); }
  if (mutation === "wrong-user") input.userId = crypto.randomUUID();
  if (mutation === "wrong-session") input.providerSessionId = "other-session";
  if (mutation === "wrong-listener") input.listenerInstanceId = crypto.randomUUID();
  if (mutation === "uncommitted") {
    await f.database.db.update(nativeLiveTurnPreparations).set({ status: "prepared", dispatchStatus: "executing", assistantMessageId: null, providerSessionId: null, providerCheckpointId: null, resultHash: null, finalizedAt: null }).where(eq(nativeLiveTurnPreparations.id, input.prepareId));
    await f.database.db.update(conversations).set({ currentHeadMessageId: f.source.command.canonical_user_message_id }).where(eq(conversations.id, f.conversation.id));
    await f.database.db.insert(nativeLiveRuntimeEvents).values({ userId: f.user.id, prepareId: input.prepareId, sequence: 1, eventType: "session", providerSessionId: "synthetic-session", payload: {} });
    assert.equal(await repo.checkTaskAdmission(input), true, "ordinary task controls allow active foreground; snapshots require committed source");
  }
  if (mutation === "head") await f.database.db.update(conversations).set({ currentHeadMessageId: null }).where(eq(conversations.id, f.conversation.id));
  if (mutation === "expired-listener") await f.database.db.update(nativeLiveRuntimeListenerLeases).set({ leaseExpiresAt: new Date(0) }).where(eq(nativeLiveRuntimeListenerLeases.userId, f.user.id));
  if (mutation === "desktop") { await f.database.db.execute(sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata,'{nativeSessionSource}','{"owner":"desktop"}'::jsonb) WHERE id=${f.conversation.id}::uuid`); await syncTestNativeSessionOwner(f.database.db, { userId: f.user.id, conversationId: f.conversation.id }); }
  if (mutation === "branch") { const branch = await f.coordinator.prepare(f.user.id, { dispatch_target: "claude_code", request_id: crypto.randomUUID(), conversation_id: f.conversation.id, operation: "send", expected_head_message_id: f.completed.assistantMessageId, text: "synthetic branch" }); assert.ok(branch.ok); if (branch.ok) await f.database.db.update(nativeLiveTurnPreparations).set({ operation: "retry" }).where(eq(nativeLiveTurnPreparations.id, branch.command.prepare_id)); }
  const before = await f.database.db.select().from(nativeLiveRuntimeEvents).where(eq(nativeLiveRuntimeEvents.prepareId, input.prepareId));
  await assert.rejects(publish(repo, input), { code: mutation === "generation" ? "CONTROL_CONFLICT" : "TURN_NOT_ACTIVE" });
  assert.deepEqual(await f.database.db.select().from(nativeLiveRuntimeEvents).where(eq(nativeLiveRuntimeEvents.prepareId, input.prepareId)), before);
});

test("authenticated task-state HTTP publication persists through the existing runtime event reader without creating turns", { skip: !enabled }, async t => {
  const f = await fixture(t);
  const { NativeLiveRuntimeControlService } = await import("../src/domains/bridge/runtime-interaction/native-live-runtime-control.js");
  const { DrizzleNativeLiveRuntimeEventRepository } = await import("../src/domains/bridge/runtime-interaction/native-live-runtime-event-stream.js");
  const { createNativeLiveRelayInternalRouter } = await import("../src/web-api/native-live-internal/router.js");
  const { withServer, FakeRelayService } = await import("./helpers/native-live-http-relay-fixtures.js");
  const service = new NativeLiveRuntimeControlService(new DrizzleNativeLiveRuntimeControlRepository(f.database.db));
  const before = await f.database.db.select().from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.userId, f.user.id));
  await withServer(app => {
    app.use((req,_res,next) => { if(req.header("x-test-owner") === "yes") req.mcpUserId = f.user.id; next(); });
    app.use(createNativeLiveRelayInternalRouter({ relayService: new FakeRelayService(), runtimeControlService: service }));
  }, async base => {
    const payload = { listener_instance_id: f.prepare.listenerInstanceId, provider_session_id: "synthetic-session", generation_id: f.prepare.generationId, snapshot_sequence: 1, tasks: [task] };
    const post = (owner: boolean) => fetch(`${base}/reservations/${f.prepare.sourcePrepareId}/task-state`, { method: "POST", headers: { "content-type": "application/json", ...(owner ? {"x-test-owner":"yes"} : {}) }, body: JSON.stringify(payload) });
    assert.equal((await post(false)).status, 401);
    const response = await post(true); assert.equal(response.status, 200); assert.deepEqual((await response.json() as any).data, {outcome:"created"});
    const duplicate = await post(true); assert.deepEqual((await duplicate.json() as any).data, {outcome:"idempotent"});
  });
  const events = await new DrizzleNativeLiveRuntimeEventRepository(f.database.db).list({ userId: f.user.id, prepareId: f.prepare.sourcePrepareId, afterSequence: 0, limit: 200 });
  assert.deepEqual(events?.map(item => item.event), [{ type: "task", provider_session_id: "synthetic-session", payload: { phase: "active_set", replace: true, tasks: [task] } }]);
  const after = await f.database.db.select().from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.userId, f.user.id));
  assert.equal(after.length, before.length);
  assert.deepEqual(after.map(({runtimeMetadata,...row})=>row), before.map(({runtimeMetadata,...row})=>row), "only task-state runtime metadata may change on the preparation");
});

test("task-state accepts SDK membership with an absent description represented as empty text", { skip: !enabled }, async t => {
  const f = await fixture(t), repo = new DrizzleNativeLiveRuntimeControlRepository(f.database.db);
  assert.deepEqual(await publish(repo, snapshot(f, 1, [{task_id:"sdk-unnamed",task_type:"unknown",description:"",ambient:false}])), {outcome:"created"});
});
