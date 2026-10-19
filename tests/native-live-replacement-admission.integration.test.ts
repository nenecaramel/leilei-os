import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages, conversationProviderSessionCheckpoints as checkpoints,
  nativeLiveTurnPreparations as preparations, nativeLiveRuntimeListenerLeases as leases } from "../src/database/schema.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveBackendRelayRepository } from "../src/domains/bridge/relay/native-live-backend-relay.js";
import { parseNativeLiveExecutionAdmissionBody } from "../src/domains/bridge/protocol/native-live-execution-admission.js";

for (const operation of ["edit", "retry"] as const) for (const source of ["new", "fork", "continuation"] as const) {
  const mode = source === "new" ? "new" : "fork";
  test(`${operation}/${source} real preparation authorizes only its captured branch and lease`, {
    skip: process.env.RUN_NATIVE_LIVE_RELAY_DATABASE_TEST !== "1",
  }, async t => {
    const { isolatedPostgresTarget, verifyIsolatedPostgresTarget } = await import("../scripts/isolated-postgres-target.mjs");
    await verifyIsolatedPostgresTarget(isolatedPostgresTarget(process.env.DATABASE_URL));
    const database = createDatabase(process.env.DATABASE_URL!, { ssl: false }), db = database.db;
    const userId = crypto.randomUUID(), conversationId = crypto.randomUUID(), target = crypto.randomUUID();
    const head = crypto.randomUUID(), parent = mode === "fork" ? crypto.randomUUID() : null;
    const session = crypto.randomUUID(), checkpoint = crypto.randomUUID(), listenerInstanceId = crypto.randomUUID();
    t.after(async () => { try {
      await db.delete(leases).where(eq(leases.userId, userId));
      await db.delete(conversations).where(eq(conversations.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    } finally { await database.close(); } });
    await db.insert(users).values({ id: userId, email: `replacement-${userId}@example.com`, displayName: "Synthetic" });
    await db.insert(conversations).values({ id: conversationId, userId, origin: "native_live" });
    if (parent) {
      await db.insert(conversationMessages).values({ id: parent, userId, conversationId, role: "assistant", status: "completed" });
      await db.insert(checkpoints).values({ userId, conversationId, canonicalMessageId: parent, provider: "claude_code",
        providerSessionId: session, providerCheckpointId: checkpoint, effectiveWorkingDirectory: "/synthetic" });
    }
    await db.insert(conversationMessages).values({ id: target, userId, conversationId, role: "user", parentMessageId: parent, status: "completed" });
    const { conversationContentBlocks } = await import("../src/database/schema.js");
    await db.insert(conversationContentBlocks).values({ userId, messageId: target, ordinal: 0, kind: "text", rawType: "text", text: "synthetic input" });
    await db.insert(conversationMessages).values({ id: head, userId, conversationId, role: "assistant", parentMessageId: target, status: "completed" });
    await db.update(conversations).set({ currentHeadMessageId: head }).where(eq(conversations.id, conversationId));
    const revision = "a".repeat(64);
    if (source === "continuation") await db.update(conversations).set({ providerMetadata: { nativeSessionSource: {
      schemaVersion: 1, mode: "continuation", owner: "leileios", sessionId: session, checkpointId: checkpoint,
      revision, nativeRevision: revision, previousRevision: null, effectiveWorkingDirectory: "/synthetic",
      headMessageId: parent, lineage: [],
    } } }).where(eq(conversations.id, conversationId));
    const port = new DrizzleNativeLiveBackendTurnPort(db);
    const identity = { prepareId: crypto.randomUUID(), userId, requestId: crypto.randomUUID(), conversationId,
      targetUserMessageId: target, executionSelection: null };
    const prepared = operation === "edit"
      ? await port.prepareEdit({ ...identity, text: "synthetic replacement", attachmentIds: [] })
      : await port.prepareRetry(identity);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) throw Error("synthetic preparation rejected");
    const [p] = await db.select().from(preparations).where(eq(preparations.id, identity.prepareId));
    assert.equal(p!.runtimeMode, mode);
    const later = new Date(Date.now() + 600_000);
    await db.insert(leases).values({ userId, dispatchTarget: "claude_code", listenerInstanceId, leaseExpiresAt: later });
    await db.update(preparations).set({ dispatchStatus: "executing", reservedBy: listenerInstanceId,
      reservedAt: new Date(), executionStartedAt: new Date(), reservationExpiresAt: later }).where(eq(preparations.id, p!.id));
    const parsed = parseNativeLiveExecutionAdmissionBody({ listener_instance_id: listenerInstanceId, request_id: p!.requestId,
      conversation_id: conversationId, runtime_mode: p!.runtimeMode, canonical_user_message_id: p!.canonicalUserMessageId,
      parent_provider_session_id: p!.parentProviderSessionId, parent_provider_checkpoint_id: p!.parentProviderCheckpointId });
    assert.ok(parsed, "the real HTTP admission parser must accept the replacement identity");
    const input = { ...parsed, reservationId: p!.id, userId };
    const relay = new DrizzleNativeLiveBackendRelayRepository(db);
    assert.equal(await relay.checkExecutionAdmission(input), true);
    assert.equal(await relay.renewExecutionLease(input), true);
    const { withServer, FakeRelayService } = await import("./helpers/native-live-http-relay-fixtures.js");
    const { createNativeLiveRelayInternalRouter } = await import("../src/web-api/native-live-internal/router.js");
    const { NativeLiveMacHttpRelayClient } = await import("../src/domains/bridge/mac/native-live-mac-http-relay-client.js");
    const relayService = Object.assign(new FakeRelayService(), {
      checkExecutionAdmission: (body: Omit<typeof input, "userId">) => relay.checkExecutionAdmission({ ...body, userId }),
      renewExecutionLease: (body: Omit<typeof input, "userId">) => relay.renewExecutionLease({ ...body, userId }),
    });
    await withServer(app => {
      app.use((request, _response, next) => { if (request.headers.authorization === "Bearer synthetic") request.mcpUserId = userId; next(); });
      app.use("/internal/native-live-relay", createNativeLiveRelayInternalRouter({ relayService }));
    }, async baseUrl => {
      const client = new NativeLiveMacHttpRelayClient(baseUrl, "synthetic");
      const command = { protocol_version: 4 as const, dispatch_target: "claude_code" as const,
        prepare_id: p!.id, request_id: p!.requestId, conversation_id: conversationId, operation, runtime_mode: mode,
        canonical_user_message_id: p!.canonicalUserMessageId, parent_provider_session_id: p!.parentProviderSessionId,
        parent_provider_checkpoint_id: p!.parentProviderCheckpointId, expected_working_directory: p!.expectedWorkingDirectory,
        prompt: "synthetic replacement" };
      assert.equal(await client.checkExecutionAdmission({listenerInstanceId, command}),true,"real Mac HTTP request reaches durable replacement admission");
      assert.equal(await client.renewExecutionLease({listenerInstanceId, command}),true,"real Mac HTTP renewal supports the replacement");
    });
    for (const key of ["userId", "listenerInstanceId", "reservationId", "requestId", "conversationId", "canonicalUserMessageId"] as const)
      assert.equal(await relay.checkExecutionAdmission({ ...input, [key]: crypto.randomUUID() }), false);
    const [c] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    await db.update(conversations).set({ currentHeadMessageId: target }).where(eq(conversations.id, conversationId));
    assert.equal(await relay.renewExecutionLease(input), false, "changed visible branch revokes replacement");
    await db.update(conversations).set({ currentHeadMessageId: head, providerMetadata: { ...c!.providerMetadata,
      native_live_presentation_owner: { prepareId: crypto.randomUUID(), anchorHeadMessageId: head } } }).where(eq(conversations.id, conversationId));
    assert.equal(await relay.checkExecutionAdmission(input), false, "superseded owner cannot authorize");
    await db.update(conversations).set({ providerMetadata: c!.providerMetadata }).where(eq(conversations.id, conversationId));
    if (parent && source !== "continuation") {
      await db.update(checkpoints).set({ providerCheckpointId: crypto.randomUUID() }).where(eq(checkpoints.canonicalMessageId, parent));
      assert.equal(await relay.checkExecutionAdmission(input), false, "fork must use the exact durable parent checkpoint");
      await db.update(checkpoints).set({ providerCheckpointId: checkpoint, effectiveWorkingDirectory: "/wrong" }).where(eq(checkpoints.canonicalMessageId, parent));
      assert.equal(await relay.checkExecutionAdmission(input), false, "fork cannot change cwd binding");
      await db.update(checkpoints).set({ effectiveWorkingDirectory: "/synthetic" }).where(eq(checkpoints.canonicalMessageId, parent));
    }
    if (source === "continuation") {
      const metadata = c!.providerMetadata;
      await db.update(conversations).set({ providerMetadata: { ...metadata, nativeSessionSource: {
        ...(metadata.nativeSessionSource as object), checkpointId: crypto.randomUUID(),
      }} }).where(eq(conversations.id,conversationId));
      assert.equal(await relay.checkExecutionAdmission(input),false,"fork must match the authoritative handoff cursor");
      await db.update(conversations).set({ providerMetadata: metadata }).where(eq(conversations.id,conversationId));
    }
    await db.update(leases).set({ leaseExpiresAt: new Date(0) }).where(eq(leases.userId, userId));
    assert.equal(await relay.renewExecutionLease(input), false, "expired listener is never revived");
    await db.update(leases).set({ leaseExpiresAt: later }).where(eq(leases.userId, userId));
    const { NativeLiveBackendTurnCoordinator } = await import("../src/domains/bridge/turn/native-live-backend-turn-coordinator.js");
    const child = crypto.randomUUID();
    const finalized = await new NativeLiveBackendTurnCoordinator(port).finalize(userId, {
      protocol_version: 4, prepare_id: p!.id, request_id: p!.requestId, conversation_id: conversationId,
      status: "success", provider_session_id: child, provider_checkpoint_id: crypto.randomUUID(),
      effective_working_directory: mode === "fork" ? "/synthetic" : "/",
      normalized_events: [{ type: "text", payload: { text: "synthetic child reply" } }],
    });
    assert.equal(finalized.ok, true);
    assert.equal(await relay.markCompleted({userId, listenerInstanceId, reservationId: p!.id}), "applied");
    const { DrizzleNativeLiveRuntimeControlRepository } = await import("../src/domains/bridge/runtime-interaction/native-live-runtime-control.js");
    const tasks = new DrizzleNativeLiveRuntimeControlRepository(db);
    const taskInput = { userId, listenerInstanceId, prepareId: p!.id, providerSessionId: child };
    assert.equal(await tasks.checkTaskAdmission(taskInput), true, "finalized child may run its own background tasks");
    assert.equal(await tasks.checkTaskAdmission({...taskInput,providerSessionId:session}), false, "retired parent cannot borrow child authority");
    if (source === "continuation") {
      const [current] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
      await db.update(conversations).set({ providerMetadata: {...current!.providerMetadata,nativeSessionSource: {
        ...(current!.providerMetadata.nativeSessionSource as object), revision: "b".repeat(64),
      }} }).where(eq(conversations.id,conversationId));
      assert.equal(await tasks.checkTaskAdmission(taskInput),false,"handoff generation rotation revokes child tasks");
      for (const revision of [null, "", "malformed"]) {
        await db.update(conversations).set({ providerMetadata: {...current!.providerMetadata,nativeSessionSource: {
          ...(current!.providerMetadata.nativeSessionSource as object), revision,
        }} }).where(eq(conversations.id,conversationId));
        assert.equal(await tasks.checkTaskAdmission(taskInput),false,"missing or malformed revision never proves child lineage");
      }
    }
  });
}
