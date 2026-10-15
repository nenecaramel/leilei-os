import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages, nativeLiveTurnPreparations as preparations, nativeLiveRuntimeListenerLeases as leases, conversationProviderSessionCheckpoints as checkpoints } from "../src/database/schema.js";
import { DrizzleNativeLiveBackendRelayRepository } from "../src/domains/bridge/relay/native-live-backend-relay.js";

test("execution admission PostgreSQL snapshot fences", { skip: process.env.RUN_NATIVE_LIVE_RELAY_DATABASE_TEST !== "1" }, async t => {
  const { isolatedPostgresTarget, verifyIsolatedPostgresTarget } = await import("../scripts/isolated-postgres-target.mjs");
  assert.ok(process.env.DATABASE_URL);
  await verifyIsolatedPostgresTarget(isolatedPostgresTarget(process.env.DATABASE_URL));
  const database = createDatabase(process.env.DATABASE_URL, { ssl: false });
  const db = database.db;
  const userId = crypto.randomUUID(), conversationId = crypto.randomUUID(), canonicalUserMessageId = crypto.randomUUID(), reservationId = crypto.randomUUID(), requestId = crypto.randomUUID(), listenerInstanceId = crypto.randomUUID();
  t.after(async () => { try { await db.delete(leases).where(eq(leases.userId, userId)); await db.delete(conversations).where(eq(conversations.userId, userId)); await db.delete(users).where(eq(users.id, userId)); } finally { await database.close(); } });
  await db.insert(users).values({ id: userId, email: `admission-${userId}@example.com`, displayName: "Synthetic admission" });
  await db.insert(conversations).values({ id: conversationId, userId, origin: "native_live", providerMetadata: { native_live_presentation_owner: { prepareId: reservationId, anchorHeadMessageId: canonicalUserMessageId } } });
  await db.insert(conversationMessages).values({ id: canonicalUserMessageId, userId, conversationId, role: "user", createdAt: new Date("2026-01-01T00:00:00Z") });
  await db.update(conversations).set({ currentHeadMessageId: canonicalUserMessageId }).where(eq(conversations.id, conversationId));
  const later = new Date(Date.now() + 600_000), earlier = new Date(Date.now() - 600_000);
  await db.insert(leases).values({ userId, dispatchTarget: "claude_code", listenerInstanceId, leaseExpiresAt: later });
  await db.insert(preparations).values({ id: reservationId, userId, requestId, conversationId, operation: "send", requestHash: "a".repeat(64), canonicalUserMessageId, runtimeMode: "new", prompt: "synthetic only", dispatchStatus: "executing", reservedBy: listenerInstanceId, reservedAt: new Date(), reservationExpiresAt: later, executionStartedAt: new Date() });
  const repository = new DrizzleNativeLiveBackendRelayRepository(db);
  let input = { userId, listenerInstanceId, reservationId, requestId, conversationId, runtimeMode: "new" as "new" | "resume", canonicalUserMessageId: canonicalUserMessageId as string | null, parentProviderSessionId: null as string | null, parentProviderCheckpointId: null as string | null };
  const check = () => repository.checkExecutionAdmission(input);
  await t.test("new admission is valid in a read-only transaction and changes no rows", async () => {
    const before = await db.select().from(preparations).where(eq(preparations.id, reservationId));
    await db.transaction(async tx => { await tx.execute(sql`SET TRANSACTION READ ONLY`); await tx.execute(sql`SET LOCAL statement_timeout = '5s'`); assert.equal(await new DrizzleNativeLiveBackendRelayRepository(tx as typeof db).checkExecutionAdmission(input), true); });
    assert.deepEqual(await db.select().from(preparations).where(eq(preparations.id, reservationId)), before);
  });
  await t.test("wrong user, listener, request and conversation cannot authorize", async () => {
    for (const key of ["userId", "listenerInstanceId", "requestId", "conversationId", "reservationId"] as const) assert.equal(await repository.checkExecutionAdmission({ ...input, [key]: crypto.randomUUID() }), false);
  });
  await t.test("late result ownership is not execution authority", async () => {
    for (const dispatchStatus of ["delivery_unknown", "completed"] as const) { await db.update(preparations).set({ dispatchStatus }).where(eq(preparations.id, reservationId)); assert.equal(await repository.ownsSubmitReservation(input), true); assert.equal(await check(), false); }
    await db.update(preparations).set({ dispatchStatus: "executing" }).where(eq(preparations.id, reservationId));
  });
  await t.test("execution must have actually started", async () => {
    await db.update(preparations).set({ dispatchStatus: "reserved", executionStartedAt: null }).where(eq(preparations.id, reservationId)); assert.equal(await check(), false);
    await db.update(preparations).set({ dispatchStatus: "executing", executionStartedAt: new Date() }).where(eq(preparations.id, reservationId));
  });
  await t.test("expired reservation, expired listener and listener takeover deny", async () => {
    await db.update(preparations).set({ reservationExpiresAt: earlier }).where(eq(preparations.id, reservationId)); assert.equal(await check(), false);
    await db.update(preparations).set({ reservationExpiresAt: later }).where(eq(preparations.id, reservationId));
    await db.update(leases).set({ leaseExpiresAt: earlier }).where(eq(leases.userId, userId)); assert.equal(await check(), false);
    await db.update(leases).set({ leaseExpiresAt: later, listenerInstanceId: crypto.randomUUID() }).where(eq(leases.userId, userId)); assert.equal(await check(), false);
    await db.update(leases).set({ listenerInstanceId }).where(eq(leases.userId, userId)); assert.equal(await check(), true);
  });
  await t.test("Rewind, presentation replacement and archive revoke immediately", async () => {
    await db.update(conversations).set({ currentHeadMessageId: null }).where(eq(conversations.id, conversationId)); assert.equal(await check(), false);
    await db.update(conversations).set({ currentHeadMessageId: canonicalUserMessageId, providerMetadata: { native_live_presentation_owner: { prepareId: crypto.randomUUID(), anchorHeadMessageId: canonicalUserMessageId } } }).where(eq(conversations.id, conversationId)); assert.equal(await check(), false);
    await db.update(conversations).set({ providerMetadata: { native_live_presentation_owner: { prepareId: reservationId, anchorHeadMessageId: canonicalUserMessageId } }, lifecycleStatus: "archived" }).where(eq(conversations.id, conversationId)); assert.equal(await check(), false);
    await db.update(conversations).set({ lifecycleStatus: "active" }).where(eq(conversations.id, conversationId)); assert.equal(await check(), true);
  });
  await t.test("Desktop ownership revokes execution even while the old reservation is otherwise valid", async () => {
    const owner = { native_live_presentation_owner: { prepareId: reservationId, anchorHeadMessageId: canonicalUserMessageId } };
    for (const ownership of ["desktop", "unknown"]) {
      await db.update(conversations).set({ providerMetadata: { ...owner, nativeSessionSource: { owner: ownership } } }).where(eq(conversations.id, conversationId));
      assert.equal(await check(), false);
    }
    await db.update(conversations).set({ providerMetadata: { ...owner, nativeSessionSource: { owner: "leileios" } } }).where(eq(conversations.id, conversationId)); assert.equal(await check(), true);
    await db.update(conversations).set({ providerMetadata: owner }).where(eq(conversations.id, conversationId)); assert.equal(await check(), true, "legacy source without owner remains compatible");
  });
  const parent = crypto.randomUUID(), checkpoint = crypto.randomUUID();
  await t.test("resume uses the current durable parent checkpoint and cwd binding", async () => {
    await db.insert(conversationMessages).values({ id: parent, userId, conversationId, role: "assistant", status: "completed" });
    await db.update(conversationMessages).set({ parentMessageId: parent }).where(eq(conversationMessages.id, canonicalUserMessageId));
    await db.insert(checkpoints).values({ userId, conversationId, canonicalMessageId: parent, provider: "claude_code", providerSessionId: "provider-a", providerCheckpointId: checkpoint, effectiveWorkingDirectory: "/synthetic" });
    await db.update(preparations).set({ runtimeMode: "resume", parentProviderSessionId: "provider-a", parentProviderCheckpointId: checkpoint, expectedWorkingDirectory: "/synthetic" }).where(eq(preparations.id, reservationId));
    input = { ...input, runtimeMode: "resume", parentProviderSessionId: "provider-a", parentProviderCheckpointId: checkpoint }; assert.equal(await check(), true);
    for (const patch of [{ providerCheckpointId: crypto.randomUUID() }, { providerSessionId: "other" }, { effectiveWorkingDirectory: "/other" }]) {
      await db.update(checkpoints).set(patch).where(eq(checkpoints.canonicalMessageId, parent)); assert.equal(await check(), false);
      await db.update(checkpoints).set({ providerCheckpointId: checkpoint, providerSessionId: "provider-a", effectiveWorkingDirectory: "/synthetic" }).where(eq(checkpoints.canonicalMessageId, parent));
    }
    assert.equal(await repository.checkExecutionAdmission({ ...input, parentProviderCheckpointId: crypto.randomUUID() }), false);
  });
  await t.test("normal wake admits only its current source head and latest user epoch", async wakeTest => {
    await db.delete(preparations).where(eq(preparations.id, reservationId));
    const head = crypto.randomUUID(); await db.insert(conversationMessages).values({ id: head, userId, conversationId, parentMessageId: canonicalUserMessageId, role: "assistant" });
    await db.insert(checkpoints).values({ userId, conversationId, canonicalMessageId: head, provider: "claude_code", providerSessionId: "provider-a", providerCheckpointId: checkpoint, effectiveWorkingDirectory: "/synthetic" });
    await db.update(conversations).set({ currentHeadMessageId: head }).where(eq(conversations.id, conversationId));
    await db.insert(preparations).values({ id: reservationId, userId, requestId, conversationId, operation: "wake", requestHash: "a".repeat(64), runtimeMode: "resume", parentProviderSessionId: "provider-a", parentProviderCheckpointId: checkpoint, expectedWorkingDirectory: "/synthetic", wakeContext: { epoch_id: canonicalUserMessageId, source_user_message_id: canonicalUserMessageId, source_head_message_id: head }, prompt: "synthetic wake", dispatchStatus: "executing", reservedBy: listenerInstanceId, reservedAt: new Date(), reservationExpiresAt: later, executionStartedAt: new Date() });
    input = { ...input, canonicalUserMessageId: null }; assert.equal(await check(), true);
    const wakeContext = { epoch_id: canonicalUserMessageId, source_user_message_id: canonicalUserMessageId, source_head_message_id: head };
    await wakeTest.test("wake epoch must equal its actual source user", async () => {
      await db.update(preparations).set({ wakeContext: { ...wakeContext, epoch_id: crypto.randomUUID() } }).where(eq(preparations.id, reservationId));
      try { assert.equal(await check(), false); } finally { await db.update(preparations).set({ wakeContext }).where(eq(preparations.id, reservationId)); }
    });
    await wakeTest.test("a newly prepared foreground replacement prevents old wake work", async () => {
      const replacement = crypto.randomUUID();
      await db.insert(preparations).values({ id: replacement, userId, requestId: crypto.randomUUID(), conversationId, operation: "retry", requestHash: "b".repeat(64), canonicalUserMessageId, runtimeMode: "fork", parentProviderSessionId: "provider-a", parentProviderCheckpointId: checkpoint, prompt: "synthetic retry", dispatchStatus: "pending" });
      try { assert.equal(await check(), false); } finally { await db.delete(preparations).where(eq(preparations.id, replacement)); }
    });
    await db.update(conversations).set({ currentHeadMessageId: canonicalUserMessageId }).where(eq(conversations.id, conversationId)); assert.equal(await check(), false);
    await db.update(conversations).set({ currentHeadMessageId: head }).where(eq(conversations.id, conversationId));
    const other = crypto.randomUUID(); await db.insert(conversations).values({ id: other, userId, origin: "native_live" });
    await db.insert(conversationMessages).values({ userId, conversationId: other, role: "user", createdAt: new Date("2026-01-02T00:00:00Z") }); assert.equal(await check(), false);
  });
});
