import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages, conversationContentBlocks, conversationProviderSessionCheckpoints, nativeLiveTurnPreparations, nativeLiveManualCompactions, nativeLiveRuntimeListenerLeases } from "../src/database/schema.js";
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
  assert.equal((await f.database.db.execute(sql`SELECT owner FROM native_live_session_owners WHERE conversation_id=${f.input.conversationId}::uuid`))[0].owner, 'leileios');
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

for (const operation of ["retry", "edit"] as const) test(`restored ${operation} plans an exact historical branch point rather than the latest native tail`, { skip: !enabled }, async () => fixture(async f => {
  const u = randomUUID(), a = randomUUID();
  const entries = [...f.entries, row(u, f.entries[1].uuid, "user", "second user"), row(a, u, "assistant", "second reply")];
  await f.write({ ...f.input, projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(2), entries }, a) });
  const messages = await f.messages();
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(f.database.db));
  const prepared = await coordinator.prepare(f.owner, { request_id: randomUUID(), conversation_id: f.input.conversationId, dispatch_target: "claude_code", operation, target_user_message_id: messages[2].id, ...(operation === "edit" ? { text: "edited synthetic user" } : {}) });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  // Edit and Retry rewind the session in place at that exact point.
  assert.equal(prepared.command.runtime_mode, "resume");
  assert.equal(prepared.command.parent_provider_session_id, f.sessionId);
  assert.equal(prepared.command.parent_provider_checkpoint_id, f.entries[1].uuid);
  assert.notEqual(prepared.command.parent_provider_checkpoint_id, a);
}));

async function localContinuation(f: any, stopHook = false) {
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
  const assistant = stopHook ? randomUUID() : cp;
  const entries = [...f.entries, row(prepared.command.canonical_user_message_id, f.entries[1].uuid, "user", "local synthetic user"),
    { ...row(assistant, prepared.command.canonical_user_message_id, "assistant", "local synthetic reply"), sessionId: f.sessionId,
      message: { content: [{ type: "text", text: "local synthetic reply" }], stop_reason: "end_turn" } },
    ...(stopHook ? [{ uuid: cp, parentUuid: assistant, type: "system", subtype: "stop_hook_summary", sessionId: f.sessionId }] : [])];
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

test("handoff accepts a proven post-assistant stop hook and preserves the execution checkpoint through release and reacquire", { skip: !enabled }, async () => fixture(async f => {
  const local = await localContinuation(f, true);
  const before = await f.state();
  const reader = new DrizzleNativeLiveCurrentPathReader(f.database.db);
  const displayBefore = await reader.readCurrentPath({ userId: f.owner, conversationId: f.input.conversationId, limit: 100 });
  const assistant = local.entries.at(-2)!.uuid, stop = local.entries.at(-1)!.uuid;
  const next = { ...f.input, expectedHeadMessageId: local.finalized.assistantMessageId, expectedRevision: revision(1),
    projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(2), entries: local.entries }, assistant),
    nativeSnapshot: { sessionId: f.sessionId, revision: revision(2), entries: local.entries } };
  const synced = await f.write(next);
  assert.equal(synced.inserted, 0);
  assert.deepEqual((await f.state()).checkpoints, before.checkpoints, "execution checkpoint must not be rewritten to the display leaf");
  const displayAfter = await reader.readCurrentPath({ userId: f.owner, conversationId: f.input.conversationId, limit: 100 });
  assert.deepEqual(displayAfter!.messages, displayBefore!.messages);
  assert.equal(displayAfter!.currentHeadMessageId, displayBefore!.currentHeadMessageId);
  const { releaseNativeSessionToDesktop } = await import(modulePath.href);
  const released = await releaseNativeSessionToDesktop(f.database.db, { userId: f.owner, conversationId: f.input.conversationId, sessionId: f.sessionId,
    expectedHeadMessageId: synced.headMessageId, expectedRevision: revision(2), expectedCheckpointId: assistant });
  assert.equal(released.owner, "desktop");
  assert.equal((await f.database.db.execute(sql`SELECT owner FROM native_live_session_owners WHERE conversation_id=${f.input.conversationId}::uuid`))[0].owner, "desktop");
  assert.equal((await f.write({ ...next, expectedRevision: revision(2) })).outcome, "already_current");
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(f.database.db));
  const send = await coordinator.prepare(f.owner, { request_id: randomUUID(), conversation_id: f.input.conversationId,
    dispatch_target: "claude_code", operation: "send", expected_head_message_id: synced.headMessageId, text: "synthetic next input" });
  assert.ok(send.ok);
  assert.equal(send.command.parent_provider_checkpoint_id, stop, "normal resume retains the execution checkpoint");
}));

test("stop-hook equivalence refuses missing proof, other activity, other sessions and conflicting native UUIDs", { skip: !enabled }, async () => {
  for (const mutation of ["missing", "compact", "assistant", "user", "attachment", "session", "sidechain", "parent", "duplicate", "unfinished"]) {
    await fixture(async f => {
      const local = await localContinuation(f, true), before = await f.state();
      const entries = structuredClone(local.entries), tail: any = entries.at(-1), assistant: any = entries.at(-2);
      if (mutation === "compact") tail.subtype = "compact_boundary";
      if (["assistant", "user", "attachment"].includes(mutation)) tail.type = mutation;
      if (mutation === "session") tail.sessionId = randomUUID();
      if (mutation === "sidechain") tail.isSidechain = true;
      if (mutation === "parent") tail.parentUuid = f.entries[1].uuid;
      if (mutation === "duplicate") entries.push({ ...tail, parentUuid: randomUUID() });
      if (mutation === "unfinished") assistant.message.stop_reason = "tool_use";
      const next = { ...f.input, expectedHeadMessageId: local.finalized.assistantMessageId, expectedRevision: revision(1),
        projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(2), entries: local.entries }, assistant.uuid),
        ...(mutation === "missing" ? {} : { nativeSnapshot: { sessionId: f.sessionId, revision: revision(2), entries } }) };
      await assert.rejects(f.write(next), { code: "CANONICAL_CHECKPOINT_CHANGED" }, mutation);
      assert.deepEqual(await f.state(), before, mutation + " must preserve evidence");
    });
  }
});


test("Desktop release refuses absent or corrupted durable stop-hook proof after synchronization", { skip: !enabled }, async () => {
  for (const corrupt of [false, true]) await fixture(async f => {
    const local = await localContinuation(f, true), assistant = local.entries.at(-2)!.uuid, stop = local.entries.at(-1)!.uuid;
    const next = { ...f.input, expectedHeadMessageId: local.finalized.assistantMessageId, expectedRevision: revision(1),
      projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(2), entries: local.entries }, assistant),
      nativeSnapshot: { sessionId: f.sessionId, revision: revision(2), entries: local.entries } };
    const synced = await f.write(next);
    if (corrupt) await f.database.db.execute(sql`update native_live_provider_session_entries set entry=jsonb_set(entry, '{subtype}', '"compact_boundary"'::jsonb) where user_id=${f.owner}::uuid and provider_session_id=${f.sessionId} and entry->>'uuid'=${stop}`);
    else await f.database.db.execute(sql`delete from native_live_provider_session_entries where user_id=${f.owner}::uuid and provider_session_id=${f.sessionId} and entry->>'uuid'=${stop}`);
    const before = await f.state();
    const { releaseNativeSessionToDesktop } = await import(modulePath.href);
    await assert.rejects(releaseNativeSessionToDesktop(f.database.db, { userId: f.owner, conversationId: f.input.conversationId,
      sessionId: f.sessionId, expectedHeadMessageId: synced.headMessageId, expectedRevision: revision(2), expectedCheckpointId: assistant }),
      { code: "CANONICAL_CHECKPOINT_CHANGED" });
    assert.deepEqual(await f.state(), before);
    assert.equal((await f.database.db.execute(sql`SELECT owner FROM native_live_session_owners WHERE conversation_id=${f.input.conversationId}::uuid`))[0]?.owner, "leileios");
  });
});

test("Desktop continuation after a stop-hook handoff syncs back once without rewriting the local reply or its execution checkpoint", { skip: !enabled }, async () => fixture(async f => {
  const local = await localContinuation(f, true), assistant = local.entries.at(-2)!.uuid, stop = local.entries.at(-1)!.uuid;
  const next = { ...f.input, expectedHeadMessageId: local.finalized.assistantMessageId, expectedRevision: revision(1),
    projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(2), entries: local.entries }, assistant),
    nativeSnapshot: { sessionId: f.sessionId, revision: revision(2), entries: local.entries } };
  const synced = await f.write(next);
  const { releaseNativeSessionToDesktop } = await import(modulePath.href);
  await releaseNativeSessionToDesktop(f.database.db, { userId: f.owner, conversationId: f.input.conversationId, sessionId: f.sessionId,
    expectedHeadMessageId: synced.headMessageId, expectedRevision: revision(2), expectedCheckpointId: assistant });
  const before = await f.state(), u = randomUUID(), a = randomUUID();
  const entries = [...local.entries, row(u, stop, "user", "synthetic Desktop input"), row(a, u, "assistant", "synthetic Desktop reply")];
  const back = { ...next, expectedRevision: revision(2), projection: projectNativeHistory({ sessionId: f.sessionId, revision: revision(3), entries }, a),
    nativeSnapshot: { sessionId: f.sessionId, revision: revision(3), entries } };
  assert.equal((await f.write(back)).inserted, 2);
  const after = await f.state();
  assert.deepEqual(after.messages.slice(0, 4), before.messages);
  assert.deepEqual(after.checkpoints.find((cp: any) => cp.canonicalMessageId === local.finalized.assistantMessageId),
    before.checkpoints.find((cp: any) => cp.canonicalMessageId === local.finalized.assistantMessageId));
  assert.equal((await f.database.db.execute(sql`SELECT owner FROM native_live_session_owners WHERE conversation_id=${f.input.conversationId}::uuid`))[0]?.owner, "leileios");
  assert.equal((await f.write({ ...back, expectedHeadMessageId: after.conversation.currentHeadMessageId, expectedRevision: revision(3) })).outcome, "already_current");
  assert.deepEqual(await f.state(), after);
}));

test('a rotated or forked native session continues the conversation only when it carries every synchronized message', { skip: !enabled }, async () => fixture(async f => {
  const { readNativeSessionRestoreState, releaseNativeSessionToDesktop } = await import(modulePath.href);
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from('synthetic continuation image').toString('base64') } };
  const [u, a, u2, a2, alt] = Array.from({length: 5}, () => randomUUID());
  const base = [{ ...row(u, null, 'user', 'with image'), message: { content: [image, { type: 'text', text: 'look' }] } }, row(a, u, 'assistant', 'seen')];
  const X = f.sessionId, Y = randomUUID(), Z = randomUUID();
  const restoreInput = (sessionId: string, rev: string, entries: any[], head: string, expected: { headMessageId: string | null; revision: string | null }) => ({
    ...f.input, expectedHeadMessageId: expected.headMessageId, expectedRevision: expected.revision,
    projection: projectNativeHistory({ sessionId, revision: rev, entries }, head), nativeSnapshot: { sessionId, revision: rev, entries } });
  const first = await f.write(restoreInput(X, revision(1), base, a, { headMessageId: null, revision: null }));
  assert.equal(first.outcome, 'restored');
  // Desktop rewind or LeileiOS fork: same native UUIDs, new session id, then a new turn.
  const continued = [...base, row(u2, a, 'user', 'next'), row(a2, u2, 'assistant', 'next reply')];
  const state = await readNativeSessionRestoreState(f.database.db, { userId: f.owner, conversationId: f.input.conversationId, sessionId: Y });
  assert.deepEqual([state.expectedHeadMessageId, state.expectedRevision, state.continuation, state.messageAnchor.count], [first.headMessageId, revision(1), true, 2]);
  const second = await f.write(restoreInput(Y, revision(2), continued, a2, { headMessageId: first.headMessageId, revision: revision(1) }));
  assert.equal(second.outcome, 'restored');
  assert.equal(second.inserted, 2);
  const after = await f.state();
  const source = after.conversation.providerMetadata.nativeSessionSource;
  assert.equal(source.sessionId, Y);
  assert.deepEqual(source.lineage, [X]);
  assert.equal(after.messages.length, 4);
  assert.deepEqual(after.checkpoints.map((cp: any) => [cp.providerCheckpointId, cp.providerSessionId]).sort(), [[a, Y], [a2, Y]].sort(),
    'checkpoints move to the newest session that carries their record, so older files are no longer needed');
  // The archived session can neither continue nor replace the conversation.
  await assert.rejects(f.write(restoreInput(X, revision(1), base, a, { headMessageId: second.headMessageId, revision: revision(2) })), (e: any) => e.code === 'EXPLICIT_BRANCH_SELECTION_REQUIRED');
  await assert.rejects(readNativeSessionRestoreState(f.database.db, { userId: f.owner, conversationId: f.input.conversationId, sessionId: X }), (e: any) => e.code === 'NATIVE_SOURCE_BINDING_REQUIRED');
  // A fork from before the synchronized head is a different conversation, not a continuation.
  const early = [base[0], row(alt, u, 'assistant', 'different reply')];
  await assert.rejects(f.write(restoreInput(Z, revision(3), early, alt, { headMessageId: second.headMessageId, revision: revision(2) })), (e: any) => e.code === 'EXPLICIT_BRANCH_SELECTION_REQUIRED');
  assert.deepEqual(await f.state(), after, 'refused continuation changes nothing');
  const released = await releaseNativeSessionToDesktop(f.database.db, { userId: f.owner, conversationId: f.input.conversationId, sessionId: Y,
    expectedHeadMessageId: second.headMessageId, expectedRevision: revision(2), expectedCheckpointId: a2 });
  assert.equal(released.owner, 'desktop');
  const preserved = await f.database.db.execute(sql`SELECT provider_session_id FROM native_live_provider_session_store_status
    WHERE user_id=${f.owner}::uuid AND preserve_external_session ORDER BY provider_session_id`);
  assert.deepEqual(preserved.map((r: any) => r.provider_session_id).sort(), [X, Y].sort(), 'every handed-off session is protected from branch cleanup');
}));

test("handoff continues through sessions LeileiOS itself switched to, proven by records the new session carries", { skip: !enabled }, async () => fixture(async f => {
  // Edit/Retry ran in a LeileiOS fork W; the branch then moved to Y, which carries W's records (same UUIDs).
  const W = randomUUID(), Y = randomUUID();
  const local = await localContinuation(f, true);
  // As in production: the Retry turn's checkpoint names the LeileiOS fork W.
  await f.database.db.execute(sql`UPDATE conversation_provider_session_checkpoints SET provider_session_id=${W}
    WHERE canonical_message_id=${local.finalized.assistantMessageId}::uuid`);
  const entries = local.entries.map((entry: any) => ({ ...entry, sessionId: Y }));
  const continued = { ...f.input, expectedHeadMessageId: local.finalized.assistantMessageId, expectedRevision: revision(1),
    projection: projectNativeHistory({ sessionId: Y, revision: revision(5), entries }, entries.at(-2).uuid),
    nativeSnapshot: { sessionId: Y, revision: revision(5), entries } };
  const result = await f.write(continued);
  assert.equal(result.outcome, "restored");
  assert.equal(result.headMessageId, local.finalized.assistantMessageId, "adopts the local turn, inserts nothing");
  const source = (await f.state()).conversation.providerMetadata.nativeSessionSource;
  assert.deepEqual([source.sessionId, source.lineage], [Y, [f.sessionId]]);
  const onY = (await f.state()).checkpoints;
  assert.ok(onY.length >= 2 && onY.every((cp: any) => cp.providerSessionId === Y), "fork W's and X's checkpoints now name Y");
  // Desktop then rewinds: Z carries the same records under its own session id.
  const Z = randomUUID();
  const rewound = entries.map((entry: any) => ({ ...entry, sessionId: Z }));
  const handedOff = await f.state();
  const third = await f.write({ ...continued, expectedHeadMessageId: handedOff.conversation.currentHeadMessageId, expectedRevision: revision(5),
    projection: projectNativeHistory({ sessionId: Z, revision: revision(7), entries: rewound }, rewound.at(-2).uuid),
    nativeSnapshot: { sessionId: Z, revision: revision(7), entries: rewound } });
  assert.equal(third.outcome, "restored", "fixed history keeps checkpoints of LeileiOS forks outside the lineage");
  assert.ok((await f.state()).checkpoints.every((cp: any) => cp.providerSessionId === Z), "and they follow the rewind to Z");
  assert.deepEqual((await f.state()).conversation.providerMetadata.nativeSessionSource.lineage, [f.sessionId, Y]);
  // A session that does not carry the execution record cannot vouch for it.
  const stranger = randomUUID();
  const other = local.entries.slice(0, 2).map((entry: any) => ({ ...entry, sessionId: stranger }));
  await assert.rejects(f.write({ ...continued, expectedRevision: revision(7), projection: projectNativeHistory({ sessionId: stranger, revision: revision(6), entries: other }, other[1].uuid),
    nativeSnapshot: { sessionId: stranger, revision: revision(6), entries: other } }), (e: any) => e.code === "EXPLICIT_BRANCH_SELECTION_REQUIRED");
}));

test("a Desktop turn started by a hidden prompt may extend the last synchronized reply, never change it", { skip: !enabled }, async () => fixture(async f => {
  f.input.nativeSnapshot = { sessionId: f.sessionId, revision: revision(1), entries: f.entries };
  const first = await f.write();
  // After the handoff Desktop's scheduled wake ran (hidden prompt), then the owner rewound
  // and continued, which forked a new session carrying the same records.
  const R = randomUUID(), m = randomUUID(), w = randomUUID(), u2 = randomUUID(), a2 = randomUUID();
  const entries = [...f.entries, { ...row(m, f.entries[1].uuid, "user", "hidden wake prompt"), isMeta: true },
    row(w, m, "assistant", "wake reply"), row(u2, w, "user", "next user"), row(a2, u2, "assistant", "next reply")]
    .map((entry: any) => ({ ...entry, sessionId: R }));
  const projection = projectNativeHistory({ sessionId: R, revision: revision(2), entries }, a2);
  assert.equal(projection.messages.length, 4, "the wake reply joins the synchronized reply");
  const next = { ...f.input, expectedHeadMessageId: first.headMessageId, expectedRevision: revision(1), projection,
    nativeSnapshot: { sessionId: R, revision: revision(2), entries } };
  // Changing the synchronized part is still a rewrite.
  const changed = structuredClone(entries); changed[1].message.content[0].text = "rewritten reply";
  await assert.rejects(f.write({ ...next, projection: projectNativeHistory({ sessionId: R, revision: revision(3), entries: changed }, a2),
    nativeSnapshot: { sessionId: R, revision: revision(3), entries: changed } }), { code: "NATIVE_HISTORY_REWRITTEN" });
  const result = await f.write(next);
  assert.equal(result.outcome, "restored");
  const after = await f.state();
  assert.equal(after.messages.length, 4);
  assert.equal(after.messages[1].id, first.headMessageId, "the synchronized reply keeps its row");
  assert.equal(after.messages[1].displayText, "synthetic reply\nwake reply");
  const blocks = await f.database.db.select().from(conversationContentBlocks).where(eq(conversationContentBlocks.messageId, first.headMessageId)).orderBy(conversationContentBlocks.ordinal);
  assert.deepEqual(blocks.map((b: any) => [b.ordinal, b.text]), [[0, "synthetic reply"], [1, "wake reply"]]);
  const cp = after.checkpoints.find((c: any) => c.canonicalMessageId === first.headMessageId);
  assert.deepEqual([cp.providerSessionId, cp.providerCheckpointId], [R, w], "Edit/Retry resumes after the extension");
  assert.equal((await f.write(next)).outcome, "already_current");
}));

for (const legacyVersion of [undefined, 2] as const) test(`a version-${legacyVersion ?? 1} source is upgraded once to content-only fingerprints`, { skip: !enabled }, async () => fixture(async f => {
  const { neutralFingerprintV2 } = await import(modulePath.href);
  const { readNativeSessionRestoreState, neutralFingerprint } = await import(modulePath.href);
  const first = await f.write();
  // Simulate data written before fingerprint version 2.
  const [conversation] = await f.database.db.select().from(conversations).where(eq(conversations.id, f.input.conversationId));
  const { fingerprintVersion: _v, ...legacy } = conversation!.providerMetadata.nativeSessionSource as any;
  legacy.messages = f.input.projection.messages.map((m: any) => ({ sourceMessageId: m.sourceMessageId, fingerprint: legacyVersion === 2 ? neutralFingerprintV2(m) : m.fingerprint }));
  if (legacyVersion) legacy.fingerprintVersion = legacyVersion;
  await f.database.db.update(conversations).set({ providerMetadata: { ...conversation!.providerMetadata, nativeSessionSource: legacy } }).where(eq(conversations.id, f.input.conversationId));
  const state = () => readNativeSessionRestoreState(f.database.db, { userId: f.owner, conversationId: f.input.conversationId, sessionId: f.sessionId });
  assert.equal((await state()).messageAnchor, undefined, "no anchor until upgraded");
  const replay = await f.write({ ...f.input, expectedHeadMessageId: first.headMessageId, expectedRevision: f.input.projection.revision });
  assert.deepEqual([replay.outcome, replay.inserted], ["restored", 0]);
  const upgraded = (await f.state()).conversation.providerMetadata.nativeSessionSource;
  assert.equal(upgraded.fingerprintVersion, 3);
  assert.deepEqual(upgraded.messages.map((m: any) => m.fingerprint), f.input.projection.messages.map((m: any) => neutralFingerprint(m)));
  assert.equal((await state()).messageAnchor.count, 2);
  assert.equal((await f.write({ ...f.input, expectedHeadMessageId: first.headMessageId, expectedRevision: f.input.projection.revision })).outcome, "already_current");
}));

test("after compaction only carried records move; earlier checkpoints stay on the session that still holds them", { skip: !enabled }, async () => fixture(async f => {
  // Desktop compaction keeps the preserved tail under its original UUIDs (observed on real transcripts).
  const [u1, a1, boundary, summary, u2, a2] = Array.from({ length: 6 }, () => randomUUID());
  const X = f.sessionId, Y = randomUUID();
  const base = [...f.entries, row(u1, f.entries[1].uuid, "user", "second"), row(a1, u1, "assistant", "second reply")];
  const first = await f.write({ ...f.input, projection: projectNativeHistory({ sessionId: X, revision: revision(1), entries: base }, a1), nativeSnapshot: { sessionId: X, revision: revision(1), entries: base } });
  const entries = [
    { ...row(boundary, null, "system", ""), subtype: "compact_boundary", logicalParentUuid: a1, compactMetadata: { preservedMessages: { allUuids: [a1] } } },
    { ...row(summary, boundary, "user", "summary"), isCompactSummary: true },
    { ...row(a1, summary, "assistant", "second reply"), forkedFrom: { sessionId: X, messageUuid: a1 } },
    row(u2, a1, "user", "after compaction"), row(a2, u2, "assistant", "reply after compaction")];
  const result = await f.write({ ...f.input, expectedHeadMessageId: first.headMessageId, expectedRevision: revision(1),
    projection: projectNativeHistory({ sessionId: Y, revision: revision(4), entries }, a2, { sourceSnapshots: [{ sessionId: X, revision: revision(1), entries: base }] }),
    nativeSnapshot: { sessionId: Y, revision: revision(4), entries } });
  assert.equal(result.outcome, "restored");
  const sessionOf = async (checkpoint: string) => (await f.state()).checkpoints.find((cp: any) => cp.providerCheckpointId === checkpoint)?.providerSessionId;
  assert.equal(await sessionOf(f.entries[1].uuid), X, "not carried by the compacted session: stays where it can still be forked");
  assert.equal(await sessionOf(a1), Y, "the preserved tail is carried: it moves");
  assert.equal(await sessionOf(a2), Y);
}));

test("referenced native sessions cover checkpoints, sources and in-flight turns, so archival never removes them", { skip: !enabled }, async () => fixture(async f => {
  const { listReferencedNativeSessions } = await import(modulePath.href);
  await f.write();
  const W = randomUUID();
  await f.database.db.execute(sql`UPDATE conversation_provider_session_checkpoints SET provider_session_id=${W} WHERE conversation_id=${f.input.conversationId}::uuid`);
  const { sessionIds } = await listReferencedNativeSessions(f.database.db, { userId: f.owner });
  assert.deepEqual(sessionIds, [f.sessionId, W].sort());
}));

test("restore writes a long history in a bounded number of round trips (cross-region latency)", { skip: !enabled }, async () => {
  const postgres = (await import("postgres")).default;
  const { restoreNativeSessionHistory } = await import(modulePath.href);
  let statements = 0;
  const database = createDatabase(process.env.DATABASE_URL!, { ssl: false,
    createClient: (url, max) => postgres(url, { max, prepare: false, ssl: false, debug: () => { statements++; } }) });
  const [owner] = await database.db.insert(users).values({ email: `native-batch-${randomUUID()}@example.com`, displayName: "batch" }).returning();
  try {
    const sessionId = randomUUID(), entries: any[] = [];
    let parent: string | null = null;
    for (let i = 0; i < 300; i++) {
      const uuid = randomUUID();
      entries.push(row(uuid, parent, i % 2 ? "assistant" : "user", `message ${i}`));
      parent = uuid;
    }
    const before = statements;
    const result = await restoreNativeSessionHistory(database.db, { userId: owner!.id, conversationId: randomUUID(), expectedHeadMessageId: null, expectedRevision: null,
      effectiveWorkingDirectory: "/synthetic/workspace", projection: projectNativeHistory({ sessionId, revision: revision(1), entries }, parent!),
      nativeSnapshot: { sessionId, revision: revision(1), entries } });
    assert.equal(result.inserted, 300);
    assert.ok(statements - before < 100, `restore used ${statements - before} statements for 300 messages`);
  } finally {
    await database.db.delete(conversations).where(eq(conversations.userId, owner!.id));
    await database.db.delete(users).where(eq(users.id, owner!.id));
    await database.close();
  }
});
