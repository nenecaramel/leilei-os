import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages, nativeLiveRuntimeListenerLeases } from "../src/database/schema.js";
import { DrizzleNativeLiveBackendRelayRepository, NativeLiveBackendRelayService } from "../src/domains/bridge/relay/native-live-backend-relay.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import { DrizzleNativeLiveProviderSessionStoreRepository, NativeLiveProviderSessionStoreService } from "../src/domains/bridge/provider-session/native-live-provider-session-store.js";
import { NativeLiveMacProviderSessionStore } from "../src/domains/bridge/mac/native-live-mac-provider-session-store.js";
import { NativeLiveMacResultOutbox } from "../src/domains/bridge/mac/native-live-mac-result-outbox.js";
import { NativeLiveMacDaemonLoop, type NativeLiveMacDaemonRelayClient } from "../src/domains/bridge/mac/native-live-mac-daemon-loop.js";

test("restart replays append before terminal outbox, despite both server commits losing responses", { skip: process.env.RUN_NATIVE_LIVE_RELAY_DATABASE_TEST !== "1" }, async (t) => {
  // Pin the real entrypoint ordering; importing it would start the daemon.
  const source = readFileSync(new URL("../scripts/native-live-mac-daemon.ts", import.meta.url), "utf8");
  assert.match(source, /await providerSessionStore\.recoverPendingAppends\(\);\s*const outcome = await loop\.runOnce\(\);/u);
  const directory = mkdtempSync(join(tmpdir(), "leilei-combined-recovery-"));
  const database = createDatabase(process.env.DATABASE_URL!, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `combined-${crypto.randomUUID()}@example.com`, displayName: "Combined recovery" }).returning({ id: users.id });
  t.after(async () => {
    try {
      await database.db.delete(nativeLiveRuntimeListenerLeases).where(eq(nativeLiveRuntimeListenerLeases.userId, user!.id));
      await database.db.delete(conversations).where(eq(conversations.userId, user!.id));
      await database.db.delete(users).where(eq(users.id, user!.id));
    } finally { await database.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  const userId = user!.id;
  const conversation = await new NativeLiveConversationService(new DrizzleNativeLiveConversationRepository(database.db)).createConversation({ userId, title: "Recovery" });
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
  const relay = new NativeLiveBackendRelayService(new DrizzleNativeLiveBackendRelayRepository(database.db), coordinator);
  const owner = crypto.randomUUID(), requestId = crypto.randomUUID();
  await relay.renewLease({ userId, listenerInstanceId: owner, dispatchTarget: "claude_code" });
  const prepared = await coordinator.prepare(userId, { dispatch_target: "claude_code", request_id: requestId, operation: "send", conversation_id: conversation.id, expected_head_message_id: null, text: "minimal local fixture" });
  assert.ok(prepared.ok);
  if (!prepared.ok) throw new Error("prepare failed");
  await relay.enqueuePreparation({ userId, prepareId: prepared.command.prepare_id });
  const reservation = await relay.reserveNext({ userId, listenerInstanceId: owner, dispatchTarget: "claude_code" });
  assert.ok(reservation);
  await relay.markExecutionStarted({ userId, listenerInstanceId: owner, reservationId: reservation.reservationId });
  const sessionId = crypto.randomUUID(), checkpoint = crypto.randomUUID();
  const remote = new NativeLiveProviderSessionStoreService(new DrizzleNativeLiveProviderSessionStoreRepository(database.db));
  const key = { projectKey: "/fixture", sessionId };
  const entries = [{ type: "assistant", uuid: checkpoint, message: { role: "assistant", content: [{ type: "text", text: "local result" }] } }];
  let loseAppend = true;
  const events: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    await remote.append({ userId, key: { sessionId: body.key.session_id }, appendBatchId: body.append_batch_id, entries: body.entries });
    events.push("append");
    if (loseAppend) throw new Error("append response lost after commit");
    return new Response(JSON.stringify({ success: true, data: null }));
  };
  const makeStore = () => new NativeLiveMacProviderSessionStore("https://local.fixture", "local-only", fetchImpl, join(directory, "append"));
  await assert.rejects(makeStore().append(key, entries), /response lost/u);
  const result = { protocol_version: 4 as const, prepare_id: prepared.command.prepare_id, request_id: requestId, conversation_id: conversation.id, status: "success" as const, provider_session_id: sessionId, provider_checkpoint_id: checkpoint, normalized_events: [{ type: "result" as const, payload: { status: "success", final_text: "local result" } }] };
  const entry = { listenerInstanceId: owner, reservationId: reservation.reservationId, result };
  const makeOutbox = () => new NativeLiveMacResultOutbox(join(directory, "result"));
  await makeOutbox().save(entry);
  let loseResult = true, providerCalls = 0;
  const client = { async submitResult(input: typeof entry) {
    assert.deepEqual(input, entry);
    assert.deepEqual(await remote.load({ userId, key: { sessionId } }), entries);
    events.push("result");
    const receipt = await relay.submitResult({ userId, ...input });
    assert.ok(receipt.ok);
    if (loseResult) throw new Error("terminal response lost after canonical commit");
    return { canonicalOutcome: "committed" };
  } } as unknown as NativeLiveMacDaemonRelayClient;
  const makeLoop = () => new NativeLiveMacDaemonLoop("restarted-owner", client, { async execute() { providerCalls += 1; throw new Error("provider must not execute"); } }, null, null, null, null, null, null, makeOutbox());
  // An unavailable append prevents any terminal replay, as in the real entrypoint.
  await assert.rejects(makeStore().recoverPendingAppends(), /response lost/u);
  assert.equal(events.includes("result"), false);
  loseAppend = false;
  await makeStore().recoverPendingAppends();
  assert.equal((await makeLoop().runOnce()).outcome, "delivery_unknown");
  assert.equal((await makeOutbox().list()).length, 1);
  loseResult = false;
  await makeStore().recoverPendingAppends();
  assert.equal((await makeLoop().runOnce()).outcome, "completed");
  assert.equal(providerCalls, 0);
  assert.deepEqual(await remote.load({ userId, key: { sessionId } }), entries);
  const messages = await database.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id));
  const assistants = messages.filter((message) => message.role === "assistant");
  assert.equal(assistants.length, 1);
  const [head] = await database.db.select().from(conversations).where(eq(conversations.id, conversation.id));
  assert.equal(head!.currentHeadMessageId, assistants[0]!.id);
  assert.deepEqual(events, ["append", "append", "append", "result", "result"]);
  assert.deepEqual(await makeOutbox().list(), []);
});
