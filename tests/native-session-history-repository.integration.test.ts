import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages, conversationProviderSessionCheckpoints, nativeLiveTurnPreparations, nativeLiveManualCompactions } from "../src/database/schema.js";
import { projectNativeHistory } from "../tools/claude-bridge/src/native-session-history.mjs";
import { DrizzleNativeLiveCurrentPathReader } from "../src/domains/conversation/native-live-current-path-read-repository.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";

const enabled = process.env.RUN_NATIVE_SESSION_PRESERVATION_DATABASE_TEST === "1";
const modulePath = new URL("../src/domains/conversation/native-session-history-repository.ts", import.meta.url);
const revision = (n: number) => n.toString(16).padStart(64, "0");
const row = (uuid: string, parentUuid: string | null, type: string, text: string) => ({ uuid, parentUuid, type, timestamp: "2026-10-10T00:00:00.123Z", message: { content: [{ type: "text", text }] } });

async function fixture(run: (f: any) => Promise<void>) {
  assert.ok(existsSync(modulePath), "atomic native history writer must exist");
  const { restoreNativeSessionHistory } = await import(modulePath.href);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/leileios_native_session_test");
  assert.notEqual(process.env.NODE_ENV, "production");
  const database = createDatabase(url.toString(), { ssl: false });
  const [owner] = await database.db.insert(users).values({ email: `native-history-${randomUUID()}@example.com`, displayName: "Synthetic native history" }).returning();
  const sessionId = randomUUID(), u = randomUUID(), a = randomUUID();
  const entries = [row(u, null, "user", "synthetic user"), row(a, u, "assistant", "synthetic reply")];
  const input = { userId: owner!.id, conversationId: randomUUID(), expectedHeadMessageId: null, expectedRevision: null, effectiveWorkingDirectory: "/synthetic/workspace", projection: projectNativeHistory({ sessionId, revision: revision(1), entries }, a) };
  const write = (next = input) => restoreNativeSessionHistory(database.db, next);
  const messages = () => database.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, input.conversationId)).orderBy(conversationMessages.currentPathIndex);
  const state = async () => ({ messages: await messages(), conversation: (await database.db.select().from(conversations).where(eq(conversations.id, input.conversationId)))[0], checkpoints: await database.db.select().from(conversationProviderSessionCheckpoints).where(eq(conversationProviderSessionCheckpoints.conversationId, input.conversationId)) });
  try { await run({ database, input, entries, write, messages, state, owner: owner!.id, sessionId }); }
  finally {
    await database.db.delete(conversations).where(eq(conversations.userId, owner!.id));
    await database.db.delete(users).where(eq(users.id, owner!.id));
    await database.close();
  }
}

test("native restore atomically maps original UUIDs, timestamps and exact checkpoints; retry creates no duplicates", { skip: !enabled }, async () => fixture(async f => {
  const first = await f.write();
  assert.equal(first.outcome, "restored");
  const before = await f.state();
  assert.equal(before.messages.length, 2);
  assert.deepEqual(before.messages.map((m: any) => m.sourceMessageId), f.input.projection.messages.map((m: any) => m.sourceMessageId));
  assert.notEqual(before.messages[0].id, before.messages[0].sourceMessageId);
  assert.equal(before.messages[1].parentMessageId, before.messages[0].id);
  assert.equal(before.messages[0].sourceCreatedAt.toISOString(), "2026-10-10T00:00:00.123Z");
  assert.equal(before.checkpoints.length, 1);
  assert.equal(before.checkpoints[0].providerSessionId, f.sessionId);
  assert.equal(before.checkpoints[0].providerCheckpointId, f.entries[1].uuid);
  assert.equal(before.conversation.currentHeadMessageId, before.messages[1].id);
  assert.equal((await f.write()).outcome, "already_current");
  assert.deepEqual(await f.state(), before);
  const protectedRows = await f.database.db.execute(sql`SELECT preserve_external_session FROM native_live_provider_session_store_status WHERE user_id=${f.owner}::uuid AND provider_session_id=${f.sessionId}`);
  assert.equal(protectedRows[0].preserve_external_session, true);
}));

test("native sync appends under revision/head CAS and lost-response replay remains idempotent", { skip: !enabled }, async () => fixture(async f => {
  const initial = await f.write();
  const u = randomUUID(), a = randomUUID();
  const entries = [...f.entries, row(u, f.entries[1].uuid, "user", "next user"), row(a, u, "assistant", "next reply")];
  const next = { ...f.input, expectedHeadMessageId: initial.headMessageId, expectedRevision: revision(1), projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(2), entries }, a) };
  assert.equal((await f.write(next)).outcome, "restored");
  const before = await f.state();
  assert.equal(before.messages.length, 4);
  assert.equal((await f.write(next)).outcome, "already_current");
  assert.deepEqual(await f.state(), before);
  await assert.rejects(f.write({ ...next, expectedRevision: revision(0), projection: { ...next.projection, revision: revision(3) } }), { code: "STALE_NATIVE_PROJECTION" });
  assert.deepEqual(await f.state(), before);
}));

test("native restore rejects rewritten history and leaves canonical parents/checkpoints unchanged", { skip: !enabled }, async () => fixture(async f => {
  const first = await f.write(), before = await f.state();
  const entries = structuredClone(f.entries); entries[0].message.content[0].text = "rewritten old user";
  const next = { ...f.input, expectedHeadMessageId: first.headMessageId, expectedRevision: revision(1), projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(2), entries }, entries[1].uuid) };
  await assert.rejects(f.write(next), { code: "NATIVE_HISTORY_REWRITTEN" });
  assert.deepEqual(await f.state(), before);
}));

test("native sync cannot overwrite a locally advanced canonical head or another owner's conversation", { skip: !enabled }, async () => fixture(async f => {
  await f.write();
  const before = await f.state();
  const localHead = randomUUID();
  await f.database.db.insert(conversationMessages).values({ id: localHead, userId: f.owner, conversationId: f.input.conversationId, parentMessageId: before.messages[1].id, role: "assistant", status: "completed" });
  await f.database.db.update(conversations).set({ currentHeadMessageId: localHead }).where(eq(conversations.id, f.input.conversationId));
  await assert.rejects(f.write(), { code: "CANONICAL_HEAD_CHANGED" });
  await assert.rejects(f.write({ ...f.input, userId: randomUUID() }), { code: "NATIVE_CONVERSATION_NOT_FOUND" });
  assert.equal((await f.state()).conversation.currentHeadMessageId, localHead);
}));

test("native restore rolls back source protection, head, messages and checkpoints after a real content-write fault", { skip: !enabled }, async () => fixture(async f => {
  // Install a task-owned, owner-scoped fault in this isolated test database only.
  const name = "native_history_fault_" + randomUUID().replaceAll("-", "");
  const sqlClient = f.database.db;
  await sqlClient.execute(sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic content write fault'; END $$`));
  try {
    await sqlClient.execute(sql.raw(`CREATE TRIGGER ${name} BEFORE INSERT ON conversation_content_blocks FOR EACH ROW WHEN (NEW.user_id = '${f.owner}'::uuid) EXECUTE FUNCTION ${name}()`));
    await assert.rejects(f.write(), (error: any) => (error.cause?.message ?? error.message).includes("synthetic content write fault"));
  } finally {
    await sqlClient.execute(sql.raw(`DROP TRIGGER IF EXISTS ${name} ON conversation_content_blocks`));
    await sqlClient.execute(sql.raw(`DROP FUNCTION ${name}()`));
  }
  assert.equal((await f.messages()).length, 0);
  assert.equal((await f.state()).conversation, undefined);
  const rows = await f.database.db.execute(sql`SELECT * FROM native_live_provider_session_store_status WHERE user_id=${f.owner}::uuid AND provider_session_id=${f.sessionId}`);
  assert.equal(rows.length, 0);
}));

test("concurrent delivery of the same native snapshot commits only one canonical history", { skip: !enabled }, async () => fixture(async f => {
  const results = await Promise.all([f.write(), f.write()]);
  assert.deepEqual(results.map(r => r.outcome).sort(), ["already_current", "restored"]);
  assert.equal(results[0].headMessageId, results[1].headMessageId);
  assert.equal((await f.messages()).length, 2);
}));

test("native snapshot replay cannot conceal a changed canonical provider checkpoint", { skip: !enabled }, async () => fixture(async f => {
  await f.write();
  const before = await f.state();
  const changedCheckpoint = randomUUID();
  await f.database.db.update(conversationProviderSessionCheckpoints).set({ providerCheckpointId: changedCheckpoint }).where(eq(conversationProviderSessionCheckpoints.id, before.checkpoints[0].id));
  await assert.rejects(f.write(), { code: "CANONICAL_CHECKPOINT_CHANGED" });
  assert.equal((await f.state()).checkpoints[0].providerCheckpointId, changedCheckpoint);
}));

test("restored native history uses the production reader with original dates and plans ordinary send as same-session resume", { skip: !enabled }, async () => fixture(async f => {
  const restored = await f.write();
  const reader = new DrizzleNativeLiveCurrentPathReader(f.database.db);
  const path = await reader.readCurrentPath({ userId: f.owner, conversationId: f.input.conversationId, limit: 100 });
  assert.ok(path);
  assert.deepEqual(path.messages.map(m => [m.role, m.blocks[0].text, m.createdAt]), [
    ["user", "synthetic user", "2026-10-10T00:00:00.123Z"], ["assistant", "synthetic reply", "2026-10-10T00:00:00.123Z"],
  ]);
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(f.database.db));
  const prepared = await coordinator.prepare(f.owner, { request_id: randomUUID(), conversation_id: f.input.conversationId, dispatch_target: "claude_code", operation: "send", expected_head_message_id: restored.headMessageId, text: "synthetic next turn" });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.equal(prepared.command.runtime_mode, "resume");
  assert.equal(prepared.command.parent_provider_session_id, f.sessionId);
  assert.equal(prepared.command.parent_provider_checkpoint_id, f.entries[1].uuid);
  assert.equal(prepared.command.expected_working_directory, "/synthetic/workspace");
}));

for (const operation of ["retry", "edit"] as const) test(`restored ${operation} plans an exact historical fork rather than the latest native tail`, { skip: !enabled }, async () => fixture(async f => {
  const u = randomUUID(), a = randomUUID();
  const entries = [...f.entries, row(u, f.entries[1].uuid, "user", "second user"), row(a, u, "assistant", "second reply")];
  await f.write({ ...f.input, projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(2), entries }, a) });
  const messages = await f.messages();
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(f.database.db));
  const prepared = await coordinator.prepare(f.owner, { request_id: randomUUID(), conversation_id: f.input.conversationId, dispatch_target: "claude_code", operation, target_user_message_id: messages[2].id, ...(operation === "edit" ? { text: "edited synthetic user" } : {}) });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.equal(prepared.command.runtime_mode, "fork");
  assert.equal(prepared.command.parent_provider_session_id, f.sessionId);
  assert.equal(prepared.command.parent_provider_checkpoint_id, f.entries[1].uuid);
  assert.notEqual(prepared.command.parent_provider_checkpoint_id, a);
}));

test("native sync preserves in-flight turn evidence and refuses pending/reserved manual compact", { skip: !enabled }, async () => fixture(async f => {
  const first = await f.write(), before = await f.state();
  const next = { ...f.input, expectedHeadMessageId: first.headMessageId, expectedRevision: revision(1), projection: { ...f.input.projection, revision: revision(2) } };
  for (const dispatchStatus of ["staged", "pending", "reserved", "executing", "delivery_unknown"] as const) {
    const id = randomUUID(), started = ["executing", "delivery_unknown"].includes(dispatchStatus), reserved = started || dispatchStatus === "reserved";
    await f.database.db.insert(nativeLiveTurnPreparations).values({ id, userId: f.owner, requestId: randomUUID(), conversationId: f.input.conversationId, operation: "send", canonicalUserMessageId: before.messages[0].id,
      requestHash: revision(1), runtimeMode: "resume", parentProviderSessionId: f.sessionId, parentProviderCheckpointId: f.entries[1].uuid, prompt: "synthetic pending turn", dispatchStatus,
      reservedBy: reserved ? randomUUID() : null, reservedAt: reserved ? new Date() : null, reservationExpiresAt: reserved ? new Date(Date.now() + 60_000) : null, executionStartedAt: started ? new Date() : null });
    await assert.rejects(f.write(next), { code: "NATIVE_CONVERSATION_BUSY" });
    assert.deepEqual(await f.state(), before);
    await f.database.db.delete(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, id));
  }
  for (const status of ["pending", "reserved"]) {
    const [compact] = await f.database.db.insert(nativeLiveManualCompactions).values({ userId: f.owner, conversationId: f.input.conversationId, sourceMessageId: first.headMessageId,
      expectedHeadMessageId: first.headMessageId, providerSessionId: f.sessionId, status, expiresAt: new Date(Date.now() + 60_000) }).returning();
    await assert.rejects(f.write(next), { code: "NATIVE_CONVERSATION_BUSY" });
    assert.deepEqual(await f.state(), before);
    await f.database.db.delete(nativeLiveManualCompactions).where(eq(nativeLiveManualCompactions.id, compact.id));
  }
}));

test("native sync and a concurrently prepared turn cannot both commit against the old canonical head", { skip: !enabled, timeout: 10_000 }, async () => fixture(async f => {
  const first = await f.write();
  const { restoreNativeSessionHistory } = await import(modulePath.href);
  let writerReached!: () => void, releaseWriter!: () => void, rivalRead!: () => void;
  const atWriter = new Promise<void>(r => { writerReached = r; });
  const allowWriter = new Promise<void>(r => { releaseWriter = r; });
  const atRival = new Promise<void>(r => { rivalRead = r; });
  // Only intercept timing at the real nested transaction; every read/write still
  // executes in PostgreSQL. This places the rival insert after the writer's busy read.
  const intercepted = new Proxy(f.database.db, { get(target, key) {
    if (key !== "transaction") return Reflect.get(target, key);
    return (work: any, config: any) => target.transaction((tx: any) => work(new Proxy(tx, { get(transaction, nestedKey) {
      if (nestedKey !== "transaction") return Reflect.get(transaction, nestedKey);
      return async (nestedWork: any, nestedConfig: any) => { writerReached(); await allowWriter; return transaction.transaction(nestedWork, nestedConfig); };
    } })), config);
  } });
  const rival = f.database.db.transaction(async (tx: any) => {
    const [conversation] = await tx.select().from(conversations).where(eq(conversations.id, f.input.conversationId));
    assert.equal(conversation.currentHeadMessageId, first.headMessageId);
    rivalRead(); await atWriter;
    await tx.insert(nativeLiveTurnPreparations).values({ id: randomUUID(), userId: f.owner, requestId: randomUUID(), conversationId: f.input.conversationId,
      operation: "send", canonicalUserMessageId: (await f.messages())[0].id, requestHash: revision(1), runtimeMode: "resume",
      parentProviderSessionId: f.sessionId, parentProviderCheckpointId: f.entries[1].uuid, prompt: "synthetic concurrent turn", dispatchStatus: "pending" });
  }, { isolationLevel: "serializable" });
  // Attach a rejection handler immediately; inspect the result after both settle.
  const rivalResult = rival.then(() => ({ ok: true }), (error: any) => ({ ok: false, error }));
  await Promise.race([atRival, rivalResult.then(() => { throw new Error("rival ended before its checkpoint read"); })]);
  const u = randomUUID(), a = randomUUID();
  const entries = [...f.entries, row(u, f.entries[1].uuid, "user", "new native turn"), row(a, u, "assistant", "new native reply")];
  const writer = restoreNativeSessionHistory(intercepted, { ...f.input, expectedHeadMessageId: first.headMessageId, expectedRevision: revision(1), projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(2), entries }, a) });
  const writerResult = writer.then(() => ({ ok: true }), (error: any) => ({ ok: false, error }));
  try {
    await Promise.race([atWriter, writerResult.then(() => { throw new Error("writer ended before its busy-check barrier"); })]);
    let blocked = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const locks = await f.database.db.execute(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE NOT granted AND locktype='transactionid') AS blocked`);
      if (locks[0].blocked) { blocked = true; break; }
      await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(blocked, true, "rival insert must actually wait on the writer's conversation lock");
  } finally { writerReached(); releaseWriter(); }
  const results = await Promise.all([writerResult, rivalResult]);
  assert.equal(results.filter(r => r.ok).length, 1, "stale pending preparation and advanced native head must not both commit");
  const failure = results.find(r => !r.ok) as any;
  assert.ok(failure.error.code === "NATIVE_CONVERSATION_BUSY" || (failure.error.cause?.code ?? failure.error.code) === "40001");
}));
