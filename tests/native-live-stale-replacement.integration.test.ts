import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { conversations, nativeLiveProviderSessionCleanups, nativeLiveRuntimeControls, nativeLiveTurnPreparations, users } from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";

const enabled = process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST === "1";
function assertConflict(result: { ok: boolean; code?: string }) {
  assert.equal(result.ok, false);
  assert.equal(result.code, "FINALIZE_CONFLICT");
}

async function fixture(t: test.TestContext) {
  assert.ok(process.env.DATABASE_URL);
  const database = createDatabase(process.env.DATABASE_URL, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `stale-${crypto.randomUUID()}@example.com`, displayName: "Stale replacement" }).returning();
  t.after(async () => {
    await database.db.delete(conversations).where(eq(conversations.userId, user.id));
    await database.db.delete(nativeLiveProviderSessionCleanups).where(eq(nativeLiveProviderSessionCleanups.userId, user.id));
    await database.db.delete(users).where(eq(users.id, user.id));
    await database.close();
  });
  const repository = new DrizzleNativeLiveConversationRepository(database.db);
  const port = new DrizzleNativeLiveBackendTurnPort(database.db);
  const coordinator = new NativeLiveBackendTurnCoordinator(port);
  const conversation = await repository.createConversation({ userId: user.id, title: "Replacement fencing" });
  const target = await repository.appendUserMessage({ userId: user.id, conversationId: conversation.id, parentMessageId: null });
  await repository.appendContentBlock({ userId: user.id, conversationId: conversation.id, messageId: target.id, ordinal: 0, block: { kind: "text", text: "Original" } });
  const answer = await repository.appendAssistantMessage({ userId: user.id, conversationId: conversation.id, parentMessageId: target.id });
  await repository.bindProviderCheckpoint({ userId: user.id, conversationId: conversation.id, canonicalMessageId: answer.id, checkpoint: { provider: "claude_code", providerSessionId: crypto.randomUUID(),  effectiveWorkingDirectory: null } });
  await repository.setCurrentHead({ userId: user.id, conversationId: conversation.id, messageId: answer.id });
  const scope = { userId: user.id, conversationId: conversation.id };
  const prepare = async (operation: "send" | "edit" | "retry") => {
    const prepared = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code", request_id: crypto.randomUUID(), conversation_id: conversation.id, operation,
      ...(operation === "send" ? { expected_head_message_id: answer.id, text: "Continue" } : operation === "edit" ? { target_user_message_id: target.id, text: "Edited" } : { target_user_message_id: target.id }),
    });
    assert.ok(prepared.ok, JSON.stringify(prepared));
    if (!prepared.ok) throw new Error("prepare failed");
    return prepared.command;
  };
  const finalize = (command: Awaited<ReturnType<typeof prepare>>) => coordinator.finalize(user.id, {
    protocol_version: command.protocol_version, prepare_id: command.prepare_id, request_id: command.request_id, conversation_id: conversation.id,
    status: "success", provider_session_id: `final-${command.prepare_id}`, normalized_events: [{ type: "text", payload: { text: "New answer" } }, { type: "result", payload: { status: "success" } }],
  });
  return { database, repository, port, coordinator, user, conversation, target, answer, scope, prepare, finalize };
}

for (const operation of ["edit", "retry"] as const) {
  test(`${operation}: stale finalize alone cannot purge the continued conversation`, { skip: !enabled }, async t => {
    const f = await fixture(t);
    const old = await f.prepare(operation);
    const next = await f.prepare("send");
    assert.ok((await f.finalize(next)).ok);
    const before = await f.repository.getConversation(f.scope);
    const stale = await f.finalize(old);
    const after = await f.repository.getConversation(f.scope);
    // Inspect the canonical result before the response so this catches actual deletion.
    assert.deepEqual(after, before, "no old target/answer or new descendant may be purged");
    assertConflict(stale);
  });

  // Removing either owner or anchor enforcement must recover/purge this stale turn.
  test(`${operation}: new send completion fences old recovery and finalize without deleting descendants`, { skip: !enabled }, async t => {
    const f = await fixture(t);
    const old = await f.prepare(operation);
    assert.equal((await f.port.readActiveTurn(f.scope))?.prepareId, old.prepare_id);
    const next = await f.prepare("send");
    const completed = await f.finalize(next);
    assert.ok(completed.ok, JSON.stringify(completed));
    const before = await f.repository.getConversation(f.scope);
    assert.equal(await f.port.readActiveTurn(f.scope), null, "completed newer owner must not reveal an older prepared replacement");
    const stale = await f.finalize(old);
    assertConflict(stale);
    assert.deepEqual(await f.repository.getConversation(f.scope), before, "stale result must not change head, blocks, or any old/new messages");
    assert.deepEqual(await f.finalize(old), stale, "repeated stale finalization remains harmless");
  });

  test(`${operation}: ownership loss with unchanged head fences recovery and finalize`, { skip: !enabled }, async t => {
    const f = await fixture(t);
    const old = await f.prepare(operation);
    const newer = await f.prepare(operation);
    const before = await f.repository.getConversation(f.scope);
    assert.equal((await f.port.readActiveTurn(f.scope))?.prepareId, newer.prepare_id);
    assertConflict(await f.finalize(old));
    assert.deepEqual(await f.repository.getConversation(f.scope), before);
    assert.ok((await f.finalize(newer)).ok, "valid new owner can replace normally");
  });

  test(`${operation}: head advancement alone expires the anchor even if owner remains`, { skip: !enabled }, async t => {
    const f = await fixture(t);
    const old = await f.prepare(operation);
    const nextUser = await f.repository.appendUserMessage({ ...f.scope, parentMessageId: f.answer.id });
    const nextAnswer = await f.repository.appendAssistantMessage({ ...f.scope, parentMessageId: nextUser.id });
    await f.repository.setCurrentHead({ ...f.scope, messageId: nextAnswer.id });
    const before = await f.repository.getConversation(f.scope);
    assert.equal(await f.port.readActiveTurn(f.scope), null);
    assertConflict(await f.finalize(old));
    assert.deepEqual(await f.repository.getConversation(f.scope), before);
  });

  test(`${operation}: missing ownership evidence fails closed`, { skip: !enabled }, async t => {
    const f = await fixture(t);
    const old = await f.prepare(operation);
    await f.database.db.update(conversations).set({ providerMetadata: sql`${conversations.providerMetadata} - 'native_live_presentation_owner'` }).where(eq(conversations.id, f.conversation.id));
    const before = await f.repository.getConversation(f.scope);
    assert.equal(await f.port.readActiveTurn(f.scope), null);
    assertConflict(await f.finalize(old));
    assert.deepEqual(await f.repository.getConversation(f.scope), before);
  });
}

for (const operation of ["send", "edit", "retry"] as const) {
  test(`${operation}: owned recovery, success and idempotent replay remain valid`, { skip: !enabled }, async t => {
    const f = await fixture(t);
    const command = await f.prepare(operation);
    assert.equal((await f.port.readActiveTurn(f.scope))?.prepareId, command.prepare_id);
    assert.equal(await f.port.readActiveTurn({ ...f.scope, userId: crypto.randomUUID() }), null);
    const result = await f.finalize(command);
    assert.ok(result.ok, JSON.stringify(result));
    const before = await f.repository.getConversation(f.scope);
    assert.ok(before?.messages.some(message => message.id === command.canonical_user_message_id));
    assert.equal(before?.messages.some(message => message.id === f.answer.id), operation === "send");
    assert.equal(await f.port.readActiveTurn(f.scope), null);
    assert.ok((await f.finalize(command)).ok);
    assert.deepEqual(await f.repository.getConversation(f.scope), before);
  });
}

test("turn reads project an applied interrupt as terminal without mutating canonical storage", { skip: !enabled }, async t => {
  const f = await fixture(t);
  const command = await f.prepare("retry");
  const before = await f.repository.getConversation(f.scope);
  await f.database.db.insert(nativeLiveRuntimeControls).values({ id: crypto.randomUUID(), userId: f.user.id, prepareId: command.prepare_id, kind: "interrupt", payload: {}, status: "applied", reservedBy: crypto.randomUUID(), reservedAt: new Date(), appliedAt: new Date(), receipt: {} });
  const read = await f.port.readTurn({ userId: f.user.id, prepareId: command.prepare_id });
  assert.equal(read?.canonicalStatus, "finalized_failure");
  assert.equal(read?.failureCode, "INTERRUPTED");
  assert.equal(await f.port.readActiveTurn(f.scope), null);
  const [stored] = await f.database.db.select({ status: nativeLiveTurnPreparations.status }).from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, command.prepare_id));
  assert.equal(stored.status, "prepared");
  assert.deepEqual(await f.repository.getConversation(f.scope), before);
});

test("ownership changing during active-turn hydration cannot return the earlier replacement", { skip: !enabled }, async t => {
  const f = await fixture(t);
  const old = await f.prepare("retry");
  const readTurn = f.port.readTurn.bind(f.port);
  // Keep the real reader and schedule a real writer at this read boundary.
  f.port.readTurn = async input => {
    const turn = await readTurn(input);
    if (input.prepareId === old.prepare_id) await f.prepare("send");
    return turn;
  };
  assert.equal(await f.port.readActiveTurn(f.scope), null);
  assert.equal((await f.port.readActiveTurn(f.scope))?.operation, "send");
});

for (const operation of ["edit", "retry"] as const) {
 test(`${operation}: finalize racing a locked head writer rolls back without purging its new branch`, { skip: !enabled }, async t => {
  const f = await fixture(t);
  const command = await f.prepare(operation);
  let unlock!: () => void;
  const release = new Promise<void>(resolve => { unlock = resolve; });
  let writerReady!: () => void;
  const ready = new Promise<void>(resolve => { writerReady = resolve; });
  const writer = f.database.db.transaction(async tx => {
    await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, f.conversation.id)).for("update");
    const repo = new DrizzleNativeLiveConversationRepository(tx);
    const user = await repo.appendUserMessage({ ...f.scope, parentMessageId: f.answer.id });
    const answer = await repo.appendAssistantMessage({ ...f.scope, parentMessageId: user.id });
    await repo.setCurrentHead({ ...f.scope, messageId: answer.id });
    writerReady();
    await release;
    return answer.id;
  });
  await ready;
  const pending = f.finalize(command);
  try {
    let blocked = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const rows = await f.database.db.execute(sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%conversations%'`);
      if (rows.length) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(blocked, "finalize must encounter the real concurrent conversation lock");
  } finally { unlock(); }
  const head = await writer;
  const result = await pending;
  assert.equal(result.ok, false, JSON.stringify(result));
  const after = await f.repository.getConversation(f.scope);
  assert.equal(after?.currentHeadMessageId, head);
  assert.equal(after?.messages.length, operation === "edit" ? 5 : 4, "original pair, optional detached edit, new pair all survive");
  assert.equal(await f.port.readActiveTurn(f.scope), null);
});

}
