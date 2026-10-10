import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages, conversationProviderSessionCheckpoints, nativeLiveTurnPreparations, nativeLiveManualCompactions, nativeLiveRuntimeListenerLeases } from "../src/database/schema.js";
import { projectNativeHistory } from "../tools/claude-bridge/src/native-session-history.mjs";
import { DrizzleNativeLiveCurrentPathReader } from "../src/domains/conversation/native-live-current-path-read-repository.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";

import { DrizzleNativeLiveBackendRelayRepository } from "../src/domains/bridge/relay/native-live-backend-relay.js";

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
    await database.db.delete(nativeLiveRuntimeListenerLeases).where(eq(nativeLiveRuntimeListenerLeases.userId, owner!.id));
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

test("Desktop handoff fences new send/retry/edit/compact until a released native snapshot is restored", { skip: !enabled }, async () => fixture(async f => {
  const { releaseNativeSessionToDesktop } = await import(modulePath.href);
  assert.equal(typeof releaseNativeSessionToDesktop, 'function');
  f.input.nativeSnapshot = { sessionId: f.sessionId, revision: revision(1), entries: f.entries };
  const restored = await f.write();
  const before = await f.state();
  const input = { userId: f.owner, conversationId: f.input.conversationId, sessionId: f.sessionId,
    expectedHeadMessageId: restored.headMessageId, expectedRevision: revision(1), expectedCheckpointId: f.entries[1].uuid };
  const release = () => releaseNativeSessionToDesktop(f.database.db, input);
  assert.equal((await release()).owner, 'desktop');
  assert.equal((await release()).owner, 'desktop');
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(f.database.db));
  for (const operation of ['send', 'retry', 'edit'] as const) {
    const prepared = await coordinator.prepare(f.owner, { request_id: randomUUID(), conversation_id: f.input.conversationId,
      dispatch_target: 'claude_code', operation, ...(operation === 'send'
        ? { expected_head_message_id: restored.headMessageId, text: 'blocked input' }
        : { target_user_message_id: before.messages[0].id, ...(operation === 'edit' ? { text: 'blocked edit' } : {}) }) });
    assert.equal(prepared.ok, false);
    assert.equal(prepared.code, 'SESSION_OWNED_BY_DESKTOP');
  }
  const { NativeLiveManualCompactService } = await import('../src/domains/bridge/turn/native-live-manual-compact.js');
  const compact = new NativeLiveManualCompactService(f.database.db, undefined, { isListenerOnline: async () => true });
  await assert.rejects(compact.create({ userId: f.owner, conversationId: f.input.conversationId }), { code: 'CONVERSATION_BUSY' });
  assert.deepEqual((await f.state()).messages, before.messages);
  assert.equal((await f.write({ ...f.input, expectedHeadMessageId: restored.headMessageId, expectedRevision: revision(1) })).outcome, 'already_current');
  assert.equal((await f.state()).conversation.providerMetadata.nativeSessionSource.owner, 'leileios');
  const prepared = await coordinator.prepare(f.owner, { request_id: randomUUID(), conversation_id: f.input.conversationId,
    dispatch_target: 'claude_code', operation: 'send', expected_head_message_id: restored.headMessageId, text: 'allowed input' });
  assert.equal(prepared.ok, true);
  await assert.rejects(release(), { code: 'NATIVE_CONVERSATION_BUSY' });
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

test("one physical native session cannot acquire two active LeileiOS conversations", { skip: !enabled }, async () => fixture(async f => {
  const outcomes = await Promise.allSettled([f.write(), f.write({ ...f.input, conversationId: randomUUID() })]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(value => value.status === 'rejected');
  assert.equal(rejected?.status === 'rejected' ? rejected.reason.code : null, 'NATIVE_SESSION_ALREADY_ATTACHED');
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

async function localContinuation(f: any) {
  const restored = await f.write();
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(f.database.db));
  const prepared = await coordinator.prepare(f.owner, { request_id: randomUUID(), conversation_id: f.input.conversationId, dispatch_target: "claude_code", operation: "send", expected_head_message_id: restored.headMessageId, text: "local synthetic user" });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const relay = new DrizzleNativeLiveBackendRelayRepository(f.database.db);
  const listenerInstanceId = randomUUID();
  assert.equal(await relay.enqueuePreparation({ userId: f.owner, prepareId: prepared.command.prepare_id }), "applied");
  await relay.renewLease({ userId: f.owner, listenerInstanceId });
  const reserved = await relay.reserveNext({ userId: f.owner, listenerInstanceId });
  assert.ok(reserved);
  const reservation = { userId: f.owner, listenerInstanceId, reservationId: prepared.command.prepare_id };
  assert.equal(await relay.markExecutionStarted(reservation), "applied");
  const cp = randomUUID();
  const finalized = await coordinator.finalize(f.owner, {
    protocol_version: prepared.command.protocol_version, prepare_id: prepared.command.prepare_id, request_id: prepared.command.request_id,
    conversation_id: f.input.conversationId, status: "success", provider_session_id: f.sessionId, provider_checkpoint_id: cp,
    effective_working_directory: "/synthetic/workspace",
    normalized_events: [{ type: "text", payload: { text: "local synthetic reply" } }, { type: "result", payload: { status: "success", final_text: "local synthetic reply" } }],
  });
  assert.ok(finalized.ok && finalized.outcome === "completed", JSON.stringify(finalized));
  assert.equal(await relay.markCompleted(reservation), "applied");
  const entries = [...f.entries, row(prepared.command.canonical_user_message_id, f.entries[1].uuid, "user", "local synthetic user"), row(cp, prepared.command.canonical_user_message_id, "assistant", "local synthetic reply")];
  return { entries, finalized };
}

test("switch-back sync adopts completed local turns by native UUID/checkpoint and appends only the Desktop extension", { skip: !enabled }, async () => fixture(async f => {
  const local = await localContinuation(f);
  const reader = new DrizzleNativeLiveCurrentPathReader(f.database.db);
  const before = await reader.readCurrentPath({ userId: f.owner, conversationId: f.input.conversationId, limit: 100 });
  const u = randomUUID(), a = randomUUID();
  const entries = [...local.entries, row(u, local.entries.at(-1)!.uuid, "user", "Desktop synthetic user"), row(a, u, "assistant", "Desktop synthetic reply")];
  const next = { ...f.input, expectedHeadMessageId: local.finalized.assistantMessageId, expectedRevision: revision(1), projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(3), entries }, a) };
  const result = await f.write(next);
  assert.equal(result.inserted, 2);
  const after = await reader.readCurrentPath({ userId: f.owner, conversationId: f.input.conversationId, limit: 100 });
  assert.equal(after!.messages.length, 6);
  assert.deepEqual(after!.messages.slice(0, 4), before!.messages, "local canonical IDs, blocks, dates and activity must not be rewritten");
  const messages = await f.messages();
  assert.equal(messages[2].id, local.finalized.userMessageId);
  assert.equal(messages[2].sourceMessageId, local.finalized.userMessageId);
  assert.equal(messages[3].id, local.finalized.assistantMessageId);
  assert.equal(messages[3].sourceMessageId, local.entries.at(-1)!.uuid);
  assert.equal((await f.write(next)).outcome, "already_current");
}));

test("switch-back accepts next-turn native context without rewriting the prior completed assistant", { skip: !enabled }, async () => fixture(async f => {
  const local = await localContinuation(f);
  const reader = new DrizzleNativeLiveCurrentPathReader(f.database.db);
  const before = await reader.readCurrentPath({ userId: f.owner, conversationId: f.input.conversationId, limit: 100 });
  const context = randomUUID(), meta = randomUUID();
  const entries = [...f.entries,
    { uuid: context, parentUuid: f.entries[1].uuid, type: "attachment", attachment: { type: "hook_context", content: "synthetic next-turn context" } },
    { ...row(meta, context, "user", "synthetic internal meta"), isMeta: true },
    { ...local.entries[2], parentUuid: meta }, local.entries[3],
  ];
  const projection = projectNativeHistory({ sessionId: f.sessionId, revision: revision(2), entries }, local.entries[3].uuid);
  assert.deepEqual(projection.messages.slice(0, 2), f.input.projection.messages);
  const result = await f.write({ ...f.input, expectedHeadMessageId: local.finalized.assistantMessageId, expectedRevision: revision(1), projection });
  assert.equal(result.inserted, 0);
  assert.equal(result.headMessageId, local.finalized.assistantMessageId);
  assert.deepEqual((await reader.readCurrentPath({ userId: f.owner, conversationId: f.input.conversationId, limit: 100 }))!.messages, before!.messages);
}));

test("switch-back never matches a local user by identical text when its native UUID is different", { skip: !enabled }, async () => fixture(async f => {
  const local = await localContinuation(f), before = await f.state();
  const entries = structuredClone(local.entries);
  const wrongUser = randomUUID(); entries[2].uuid = wrongUser; entries[3].parentUuid = wrongUser;
  const next = { ...f.input, expectedHeadMessageId: local.finalized.assistantMessageId, expectedRevision: revision(1), projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(2), entries }, entries[3].uuid) };
  await assert.rejects(f.write(next), { code: "CANONICAL_HEAD_CHANGED" });
  assert.deepEqual(await f.state(), before);
}));

test("switch-back rejects a mismatched local assistant checkpoint without changing evidence", { skip: !enabled }, async () => fixture(async f => {
  const local = await localContinuation(f);
  await f.database.db.update(conversationProviderSessionCheckpoints).set({ providerCheckpointId: randomUUID() })
    .where(eq(conversationProviderSessionCheckpoints.canonicalMessageId, local.finalized.assistantMessageId));
  const before = await f.state();
  const next = { ...f.input, expectedHeadMessageId: local.finalized.assistantMessageId, expectedRevision: revision(1),
    projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(2), entries: local.entries }, local.entries.at(-1)!.uuid) };
  await assert.rejects(f.write(next), { code: "CANONICAL_CHECKPOINT_CHANGED" });
  assert.deepEqual(await f.state(), before);
}));

test("native sync follows the selected parent chain and leaves off-path messages/checkpoints intact", { skip: !enabled }, async () => fixture(async f => {
  const first = await f.write();
  const offPath = randomUUID(), offCheckpoint = randomUUID();
  await f.database.db.insert(conversationMessages).values({ id: offPath, userId: f.owner, conversationId: f.input.conversationId,
    parentMessageId: first.headMessageId, role: "assistant", status: "completed", isCurrentPath: false, displayText: "off-path synthetic evidence" });
  await f.database.db.insert(conversationProviderSessionCheckpoints).values({ userId: f.owner, conversationId: f.input.conversationId,
    canonicalMessageId: offPath, provider: "claude_code", providerSessionId: randomUUID(), providerCheckpointId: offCheckpoint, effectiveWorkingDirectory: "/synthetic/workspace" });
  const before = await f.state();
  const u = randomUUID(), a = randomUUID();
  const entries = [...f.entries, row(u, f.entries[1].uuid, "user", "Desktop user"), row(a, u, "assistant", "Desktop reply")];
  const result = await f.write({ ...f.input, expectedHeadMessageId: first.headMessageId, expectedRevision: revision(1),
    projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(2), entries }, a) });
  assert.equal(result.inserted, 2);
  const after = await f.state();
  assert.deepEqual(after.messages.find((m: any) => m.id === offPath), before.messages.find((m: any) => m.id === offPath));
  assert.deepEqual(after.checkpoints.find((cp: any) => cp.canonicalMessageId === offPath), before.checkpoints.find((cp: any) => cp.canonicalMessageId === offPath));
}));

test("native sync preserves in-flight turn evidence and refuses pending/reserved manual compact", { skip: !enabled }, async () => fixture(async f => {
  const first = await f.write(), before = await f.state();
  const { releaseNativeSessionToDesktop } = await import(modulePath.href);
  const release = () => releaseNativeSessionToDesktop(f.database.db, { userId: f.owner, conversationId: f.input.conversationId,
    sessionId: f.sessionId, expectedHeadMessageId: first.headMessageId, expectedRevision: revision(1), expectedCheckpointId: f.entries[1].uuid });
  const next = { ...f.input, expectedHeadMessageId: first.headMessageId, expectedRevision: revision(1), projection: { ...f.input.projection, revision: revision(2) } };
  for (const dispatchStatus of ["staged", "pending", "reserved", "executing", "delivery_unknown"] as const) {
    const id = randomUUID(), started = ["executing", "delivery_unknown"].includes(dispatchStatus), reserved = started || dispatchStatus === "reserved";
    await f.database.db.insert(nativeLiveTurnPreparations).values({ id, userId: f.owner, requestId: randomUUID(), conversationId: f.input.conversationId, operation: "send", canonicalUserMessageId: before.messages[0].id,
      requestHash: revision(1), runtimeMode: "resume", parentProviderSessionId: f.sessionId, parentProviderCheckpointId: f.entries[1].uuid, prompt: "synthetic pending turn", dispatchStatus,
      reservedBy: reserved ? randomUUID() : null, reservedAt: reserved ? new Date() : null, reservationExpiresAt: reserved ? new Date(Date.now() + 60_000) : null, executionStartedAt: started ? new Date() : null });
    await assert.rejects(f.write(next), { code: "NATIVE_CONVERSATION_BUSY" });
    await assert.rejects(release(), { code: "NATIVE_CONVERSATION_BUSY" });
    assert.deepEqual(await f.state(), before);
    await f.database.db.delete(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, id));
  }
  for (const status of ["pending", "reserved"]) {
    const [compact] = await f.database.db.insert(nativeLiveManualCompactions).values({ userId: f.owner, conversationId: f.input.conversationId, sourceMessageId: first.headMessageId,
      expectedHeadMessageId: first.headMessageId, providerSessionId: f.sessionId, status, expiresAt: new Date(Date.now() + 60_000) }).returning();
    await assert.rejects(f.write(next), { code: "NATIVE_CONVERSATION_BUSY" });
    await assert.rejects(release(), { code: "NATIVE_CONVERSATION_BUSY" });
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

test("native restore durably seeds original transcript and lost-ack retry does not duplicate records", { skip: !enabled }, async () => fixture(async f => {
  const { DrizzleNativeLiveProviderSessionStoreRepository } = await import("../src/domains/bridge/provider-session/native-live-provider-session-store.js");
  const store = new DrizzleNativeLiveProviderSessionStoreRepository(f.database.db);
  const entries = [...f.entries, { type: "file-history-snapshot", snapshot: { original: true }, messageId: randomUUID() }];
  const input = { ...f.input, nativeSnapshot: { sessionId: f.sessionId, revision: revision(1), entries } };
  await f.write(input);
  assert.deepEqual(await store.load({ userId: f.owner, key: { sessionId: f.sessionId } }), entries);
  assert.equal(await store.getStatus({ userId: f.owner, sessionId: f.sessionId }), "complete");
  assert.equal((await f.write(input)).outcome, "already_current");
  assert.deepEqual(await store.load({ userId: f.owner, key: { sessionId: f.sessionId } }), entries);
}));

test("native cache extends exact prefix, retains identical distinct records and rejects rewritten or shorter sources atomically", { skip: !enabled }, async () => fixture(async f => {
  const { DrizzleNativeLiveProviderSessionStoreRepository } = await import("../src/domains/bridge/provider-session/native-live-provider-session-store.js");
  const store = new DrizzleNativeLiveProviderSessionStoreRepository(f.database.db);
  await store.preserveExternalSession({ userId: f.owner, sessionId: f.sessionId });
  const repeated = { type: "progress", data: "same payload at distinct transcript positions" };
  const sync = (entries: any[]) => store.synchronizeNativeSnapshot({ userId: f.owner, key: { sessionId: f.sessionId }, entries });
  assert.equal((await sync([...f.entries, repeated])).inserted, 3);
  assert.equal((await sync([...f.entries, repeated, repeated])).inserted, 1);
  assert.equal((await sync([...f.entries, repeated, repeated])).inserted, 0);
  const before = await store.load({ userId: f.owner, key: { sessionId: f.sessionId } });
  await assert.rejects(sync(f.entries), { code: "NATIVE_TRANSCRIPT_DIVERGED" });
  const changed = structuredClone(before!); changed[0].message.content[0].text = "changed";
  await assert.rejects(sync(changed), { code: "NATIVE_TRANSCRIPT_DIVERGED" });
  assert.deepEqual(await store.load({ userId: f.owner, key: { sessionId: f.sessionId } }), before);
  await assert.rejects(store.synchronizeNativeSnapshot({ userId: f.owner, key: { sessionId: randomUUID() }, entries: f.entries }), { code: "EXTERNAL_SESSION_NOT_PRESERVED" });
}));

test("concurrent native imports serialize and chunked identical records retain every position", { skip: !enabled }, async () => fixture(async f => {
  const { DrizzleNativeLiveProviderSessionStoreRepository } = await import("../src/domains/bridge/provider-session/native-live-provider-session-store.js");
  const store = new DrizzleNativeLiveProviderSessionStoreRepository(f.database.db);
  await store.preserveExternalSession({ userId: f.owner, sessionId: f.sessionId });
  const entries = [...f.entries, ...Array.from({ length: 205 }, () => ({ type: "progress", data: "repeat" }))];
  const input = { userId: f.owner, key: { sessionId: f.sessionId }, entries };
  const results = await Promise.all([store.synchronizeNativeSnapshot(input), store.synchronizeNativeSnapshot(input)]);
  assert.deepEqual(results.map(result => result.inserted).sort((a, b) => a - b), [0, 207]);
  assert.deepEqual(await store.load(input), entries);
  await store.synchronizeNativeSnapshot({ ...input, key: { sessionId: f.sessionId, subpath: "subagents/synthetic" }, entries: [entries[2]] });
  assert.deepEqual(await store.load(input), entries);
  assert.deepEqual(await store.load({ ...input, key: { sessionId: f.sessionId, subpath: "subagents/synthetic" } }), [entries[2]]);
}));

test("failed canonical restore rolls back transcript seeding and its completeness/preservation claims", { skip: !enabled }, async () => fixture(async f => {
  const { DrizzleNativeLiveProviderSessionStoreRepository } = await import("../src/domains/bridge/provider-session/native-live-provider-session-store.js");
  const store = new DrizzleNativeLiveProviderSessionStoreRepository(f.database.db);
  // Roll back the outer restore transaction after its nested writes succeed.
  await assert.rejects(f.database.db.transaction(async (tx: any) => {
    const { restoreNativeSessionHistory } = await import(modulePath.href);
    await restoreNativeSessionHistory(tx, { ...f.input, nativeSnapshot: { sessionId: f.sessionId, revision: revision(1), entries: f.entries } });
    throw new Error("synthetic lost transaction");
  }), /synthetic lost transaction/);
  assert.equal(await store.load({ userId: f.owner, key: { sessionId: f.sessionId } }), null);
  assert.equal(await store.getStatus({ userId: f.owner, sessionId: f.sessionId }), null);
  assert.equal((await f.state()).messages.length, 0);
}));

test("native restore cannot mark an interrupted nonempty replica complete", { skip: !enabled }, async () => fixture(async f => {
  const { DrizzleNativeLiveProviderSessionStoreRepository } = await import("../src/domains/bridge/provider-session/native-live-provider-session-store.js");
  const store = new DrizzleNativeLiveProviderSessionStoreRepository(f.database.db);
  await store.preserveExternalSession({ userId: f.owner, sessionId: f.sessionId });
  await store.append({ userId: f.owner, key: { sessionId: f.sessionId }, appendBatchId: randomUUID(), entries: f.entries });
  await assert.rejects(f.write({ ...f.input, nativeSnapshot: { sessionId: f.sessionId, revision: revision(1), entries: f.entries } }), { code: "NATIVE_SESSION_RECOVERY_REQUIRED" });
  assert.equal(await store.getStatus({ userId: f.owner, sessionId: f.sessionId }), "incomplete");
  assert.equal((await f.state()).messages.length, 0);
  assert.deepEqual(await store.load({ userId: f.owner, key: { sessionId: f.sessionId } }), f.entries);
}));

test("fixed restore entry reaches authenticated HTTP writer and isolated DB; lost HTTP ack retry creates one history", { skip: !enabled }, async () => fixture(async f => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const { withServer } = await import("./helpers/native-live-http-relay-fixtures.js");
  const { createNativeLiveProviderSessionStoreInternalRouter } = await import("../src/web-api/native-live-provider-session-store-internal-router.js");
  const { restoreNativeSessionHistory, readNativeSessionRestoreState, releaseNativeSessionToDesktop } = await import(modulePath.href);
  const { restoreDesktopNativeSession, handoffNativeSessionToDesktop } = await import("../tools/claude-bridge/src/native-session-switch-restore.mjs");
  const { DrizzleNativeLiveProviderSessionStoreRepository } = await import("../src/domains/bridge/provider-session/native-live-provider-session-store.js");
  const root = await mkdtemp(join(tmpdir(), "native-restore-e2e-"));
  const configDirectory = join(root, "config"), projectDirectory = join(configDirectory, "projects", "-synthetic-workspace"), peerDirectory = join(configDirectory, "sessions");
  const indexFile = join(root, "desktop.json"), transcriptFile = join(projectDirectory, f.sessionId + ".jsonl");
  try {
    await mkdir(projectDirectory, { recursive: true }); await mkdir(peerDirectory);
    const bytes = f.entries.map(JSON.stringify).join("\n");
    await writeFile(transcriptFile, bytes);
    await writeFile(indexFile, JSON.stringify({ sessionId: "local_" + randomUUID(), cliSessionId: f.sessionId, lastAssistantUuid: f.entries[1].uuid, cwd: "/synthetic/workspace" }));
    const input = { configDirectory, projectDirectory, peerDirectory, indexFile, expectedSessionId: f.sessionId,
      recoveryDirectory: join(root, 'recovery'),
      expectedCheckpointId: f.entries[1].uuid, expectedRevision: createHash("sha256").update(bytes).digest("hex") };
    await withServer(app => {
      app.use((request, response, next) => {
        if (request.header("authorization") !== "Bearer synthetic-restore-token") { response.sendStatus(401); return; }
        request.mcpUserId = f.owner; next();
      });
      app.use("/internal/native-live-session-store", createNativeLiveProviderSessionStoreInternalRouter({
        providerSessionStoreService: {} as any,
        restoreNativeHistory: value => restoreNativeSessionHistory(f.database.db, value),
        readNativeHistoryState: value => readNativeSessionRestoreState(f.database.db, value),
        releaseNativeHistory: value => releaseNativeSessionToDesktop(f.database.db, value),
      }));
    }, async relayUrl => {
      const options = { input, conversationId: f.input.conversationId, relayUrl, relayToken: "synthetic-restore-token" };
      let requests = 0;
      await assert.rejects(restoreDesktopNativeSession({ ...options, fetchImpl: async (url: any, value: any) => {
        requests++; const response = await fetch(url, value);
        if (String(url).endsWith("/restore")) { await response.text(); throw new Error("synthetic lost HTTP response after commit"); }
        return response;
      } }), { code: "NATIVE_RESTORE_UNAVAILABLE" });
      assert.equal(requests, 2, "no automatic HTTP replay");
      assert.equal((await f.messages()).length, 2);
      const retry = await restoreDesktopNativeSession(options);
      assert.equal(retry.outcome, "already_current"); assert.equal(retry.inserted, 0);
      assert.equal((await f.messages()).length, 2);
      const store = new DrizzleNativeLiveProviderSessionStoreRepository(f.database.db);
      assert.deepEqual(await store.load({ userId: f.owner, key: { sessionId: f.sessionId } }), f.entries);
      assert.equal(await store.getStatus({ userId: f.owner, sessionId: f.sessionId }), "complete");
      assert.equal((await f.state()).checkpoints.length, 1);
      let launches = 0;
      await handoffNativeSessionToDesktop({ ...options, recoveryDirectory: input.recoveryDirectory, launchImpl: async selection => {
        launches++; assert.equal(selection.providerSessionId, f.sessionId);
        assert.equal((await f.state()).conversation.providerMetadata.nativeSessionSource.owner, 'desktop');
      } });
      assert.equal(launches, 1);
      assert.equal((await f.messages()).length, 2);
      assert.equal((await restoreDesktopNativeSession(options)).outcome, 'already_current');
      assert.equal((await f.state()).conversation.providerMetadata.nativeSessionSource.owner, 'leileios');
      assert.equal((await f.messages()).length, 2);
    });
    assert.equal(await readFile(transcriptFile, "utf8"), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
}));

test("native historical assets bind only verified owned bytes in place; retries and later sync preserve history", { skip: !enabled }, async () => fixture(async f => {
  const { nativeSessionAsset } = await import('../src/domains/conversation/native-session-asset-repository.js');
  const { nativeLiveChatAttachments, conversationContentBlocks, conversationAttachments } = await import('../src/database/schema.js');
  const { createHash } = await import('node:crypto');
  const source = { type: 'base64', media_type: 'image/png', data: Buffer.from('synthetic image bytes').toString('base64') };
  f.entries[0].message.content.push({ type: 'image', source });
  f.input.projection = projectNativeHistory({ sessionId: f.sessionId, revision: revision(1), entries: f.entries }, f.entries[1].uuid);
  f.input.nativeSnapshot = { sessionId: f.sessionId, revision: revision(1), entries: f.entries };
  await f.write();
  const request = { userId: f.owner, conversationId: f.input.conversationId, sessionId: f.sessionId,
    expectedRevision: revision(1), sourceEntryUuid: f.entries[0].uuid, sourceBlockOrdinal: 1 };
  const asset = await nativeSessionAsset(f.database.db, request);
  assert.equal(asset.attachmentId, null); assert.equal(asset.mimeType, 'image/png');
  assert.equal(asset.sizeBytes, Buffer.from(source.data, 'base64').length);
  assert.equal(asset.sha256, createHash('sha256').update(Buffer.from(source.data, 'base64')).digest('hex'));
  const [bad] = await f.database.db.insert(nativeLiveChatAttachments).values({ id: randomUUID(), userId: f.owner, objectKey: 'synthetic/' + randomUUID(), filename: 'image.png', mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes, sha256: '0'.repeat(64), kind: 'image', status: 'ready', readyAt: new Date(), expiresAt: new Date(Date.now()+60000) }).returning();
  await assert.rejects(nativeSessionAsset(f.database.db, { ...request, attachmentId: bad.id }), { code: 'NATIVE_ASSET_MISMATCH' });
  const [ready] = await f.database.db.insert(nativeLiveChatAttachments).values({ id: randomUUID(), userId: f.owner, objectKey: 'synthetic/' + randomUUID(), filename: asset.filename, mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes, sha256: asset.sha256, kind: 'image', status: 'ready', readyAt: new Date(), expiresAt: new Date(Date.now()+60000) }).returning();
  const before = await f.state();
  const result = await nativeSessionAsset(f.database.db, { ...request, attachmentId: ready.id });
  assert.equal(result.attachmentId, ready.id);
  assert.deepEqual(await f.state(), before, 'materialization never changes message/head/checkpoint');
  assert.equal((await nativeSessionAsset(f.database.db, { ...request, attachmentId: ready.id })).attachmentId, ready.id);
  const attachments = await f.database.db.select().from(conversationAttachments).where(eq(conversationAttachments.userId, f.owner));
  assert.equal(attachments.length, 1);
  const blocks = await f.database.db.select().from(conversationContentBlocks).where(eq(conversationContentBlocks.userId, f.owner));
  const image = blocks.find((b: any) => b.rawType === 'image');
  assert.equal(image.kind, 'attachment'); assert.equal(image.payload.attachment_id, ready.id); assert.equal(image.ordinal, 1);
  assert.equal((await f.write()).outcome, 'already_current');
  assert.equal((await nativeSessionAsset(f.database.db, request)).attachmentId, ready.id);
  const payload = { ...image.payload };
  for (const key of ['source_entry_uuid','source_block_ordinal','source_session_id','source_asset_hash','source_type']) delete payload[key];
  await f.database.db.update(conversationContentBlocks).set({ payload }).where(eq(conversationContentBlocks.id,image.id));
  assert.equal((await nativeSessionAsset(f.database.db, request)).attachmentId,ready.id,'reuse an existing canonical attachment by exact native user UUID and bytes');
  await assert.rejects(nativeSessionAsset(f.database.db, { ...request, expectedRevision: revision(2) }), { code: 'STALE_NATIVE_PROJECTION' });
  await assert.rejects(nativeSessionAsset(f.database.db, { ...request, userId: randomUUID() }), { code: 'NATIVE_SOURCE_BINDING_REQUIRED' });
}));

test('native restore materializes original image and PDF through upload/HEAD/complete then ordinary download; lost bind ack is idempotent', { skip: !enabled }, async () => fixture(async f => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { createHash } = await import('node:crypto'); const { default: express } = await import('express');
  const { withServer } = await import('./helpers/native-live-http-relay-fixtures.js');
  const { createNativeLiveProviderSessionStoreInternalRouter } = await import('../src/web-api/native-live-provider-session-store-internal-router.js');
  const { createInternalAttachmentUploadSlotHandler, completeInternalAttachmentUploadHandler } = await import('../src/web-api/native-live-internal/attachments.js');
  const { NativeLiveAttachmentService } = await import('../src/domains/bridge/attachment/native-live-attachment-service.js');
  const { nativeSessionAsset } = await import('../src/domains/conversation/native-session-asset-repository.js');
  const { restoreNativeSessionHistory, readNativeSessionRestoreState } = await import(modulePath.href);
  const { restoreDesktopNativeSession } = await import('../tools/claude-bridge/src/native-session-switch-restore.mjs');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j99kAAAAASUVORK5CYII=', 'base64');
  const document = Buffer.from('%PDF-1.4\nsynthetic document fixture\n%%EOF');
  f.entries[0].message.content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.toString('base64') } }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: document.toString('base64') } });
  const root = await mkdtemp(join(tmpdir(), 'native-asset-e2e-')), configDirectory = join(root, 'config'), projectDirectory = join(configDirectory, 'projects', '-synthetic'), peerDirectory = join(configDirectory, 'sessions');
  await mkdir(projectDirectory, { recursive: true }); await mkdir(peerDirectory);
  const transcriptFile = join(projectDirectory, f.sessionId+'.jsonl'), text = f.entries.map(JSON.stringify).join('\n');
  await writeFile(transcriptFile, text); const indexFile = join(root, 'index.json');
  await writeFile(indexFile, JSON.stringify({ sessionId: 'local_'+randomUUID(), cliSessionId: f.sessionId, lastAssistantUuid: f.entries[1].uuid, cwd: '/synthetic/workspace' }));
  const input = { configDirectory, projectDirectory, peerDirectory, indexFile, expectedSessionId: f.sessionId, expectedCheckpointId: f.entries[1].uuid, expectedRevision: createHash('sha256').update(text).digest('hex') };
  const objects = new Map<string, any>(); let base = '', puts = 0, heads = 0, lostBind = true;
  const store = {
    createUploadSlot: ({ objectKey, mimeType, sha256 }: any) => ({ url: base+'/objects/'+encodeURIComponent(objectKey), method: 'PUT', headers: { 'content-type': mimeType, 'x-amz-meta-sha256': sha256 }, expiresAt: new Date(Date.now()+60000).toISOString() }),
    createDownloadSlot: ({ objectKey }: any) => ({ url: base+'/objects/'+encodeURIComponent(objectKey), method: 'GET', headers: {}, expiresAt: new Date(Date.now()+60000).toISOString() }),
    headObject: async ({ objectKey }: any) => { heads++; const obj=objects.get(objectKey); return obj ? { sizeBytes: obj.bytes.length, mimeType: obj.mimeType, sha256: obj.sha256 } : null; },
    deleteObject: async () => assert.fail('restore must not delete objects'),
  };
  const attachments = new NativeLiveAttachmentService(f.database.db, store as any, { maxFileBytes: 1024*1024, unboundTtlSeconds: 600 });
  try { await withServer(app => {
    app.use((req, _res, next) => { req.mcpUserId=f.owner; next(); });
    app.put('/objects/:key', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => { assert.equal(req.headers.authorization, undefined); puts++; objects.set(String(req.params.key), { bytes: req.body, mimeType: req.headers['content-type'], sha256: req.headers['x-amz-meta-sha256'] }); res.sendStatus(200); });
    app.get('/objects/:key', (req, res) => { const obj=objects.get(String(req.params.key)); obj ? res.type(obj.mimeType).send(obj.bytes) : res.sendStatus(404); });
    app.use('/internal/native-live-session-store', createNativeLiveProviderSessionStoreInternalRouter({ providerSessionStoreService: {} as any,
      restoreNativeHistory: v => restoreNativeSessionHistory(f.database.db, v), readNativeHistoryState: v => readNativeSessionRestoreState(f.database.db,v),
      nativeHistoryAsset: async v => { const result=await nativeSessionAsset(f.database.db,v); if(v.attachmentId && lostBind) {lostBind=false; throw new Error('synthetic bind response lost after commit');} return result; },
    }));
    app.post('/internal/native-live-relay/attachments/upload-slots', createInternalAttachmentUploadSlotHandler({ attachmentService: attachments } as any));
    app.post('/internal/native-live-relay/attachments/:attachmentId/complete', completeInternalAttachmentUploadHandler({ attachmentService: attachments } as any));
  }, async url => {
    base=url;
    const restore = () => restoreDesktopNativeSession({ input, conversationId: f.input.conversationId, relayUrl: url, relayToken: 'SYNTHETIC', recoveryDirectory: join(root,'recovery') });
    await assert.rejects(restore(), { code: 'NATIVE_RESTORE_UNAVAILABLE' });
    const result=await restore(); assert.deepEqual(result.assets,{ materialized:2,unavailable:0 });
    const { conversationAttachments } = await import('../src/database/schema.js');
    const rows=await f.database.db.select().from(conversationAttachments).where(eq(conversationAttachments.userId,f.owner)).orderBy(conversationAttachments.ordinal);
    assert.equal(rows.length,2); assert.equal((await f.messages()).length,2); assert.equal(puts,2); assert.equal(heads,2);
    const current = await new DrizzleNativeLiveCurrentPathReader(f.database.db).readCurrentPath({userId:f.owner,conversationId:f.input.conversationId,limit:100});
    const visible = current!.messages[0]!.blocks.filter(block => block.kind === 'attachment');
    assert.equal(visible.length,2);
    assert.deepEqual(visible.map(block => block.payload?.attachment_id),rows.map(row => row.sourceAttachmentId));
    for(const [i,row] of rows.entries()) {
      const slot=await attachments.createDownloadSlot({ userId:f.owner,attachmentId:row.sourceAttachmentId! });
      const bytes=Buffer.from(await (await fetch(slot.download.url)).arrayBuffer());
      assert.deepEqual(bytes,[image,document][i]); assert.equal(slot.attachment.sha256,createHash('sha256').update(bytes).digest('hex'));
    }
    assert.equal((await restore()).assets.materialized,2); assert.equal(puts,2);
    assert.equal(await readFile(transcriptFile,'utf8'),text);
  }); } finally { await rm(root,{recursive:true,force:true}); }
}));
