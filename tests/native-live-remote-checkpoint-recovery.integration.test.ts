import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages } from "../src/database/schema.js";
import { AgentSdkClaudeTransport } from "../tools/claude-bridge/src/agent-sdk-claude-transport.mjs";
import { NativeLiveMacProviderSessionStore } from "../src/domains/bridge/mac/native-live-mac-provider-session-store.js";
import { NativeLiveProviderSessionStoreService, DrizzleNativeLiveProviderSessionStoreRepository } from "../src/domains/bridge/provider-session/native-live-provider-session-store.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";

test("failed remote resume then checkpoint recovery commits one canonical assistant with the real SessionStore adapter", { skip: process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST !== "1" }, async (t) => {
  const database = createDatabase(process.env.DATABASE_URL!, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `remote-checkpoint-${randomUUID()}@example.com`, displayName: "Checkpoint recovery" }).returning();
  t.after(async () => {
    try {
      await database.db.delete(conversations).where(eq(conversations.userId, user!.id));
      await database.db.delete(users).where(eq(users.id, user!.id));
    } finally { await database.close(); }
  });
  const userId = user!.id;
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
  const conversation = await new NativeLiveConversationService(new DrizzleNativeLiveConversationRepository(database.db)).createConversation({ userId, title: "Recovery" });
  const remote = new NativeLiveProviderSessionStoreService(new DrizzleNativeLiveProviderSessionStoreRepository(database.db));
  const sessionId = randomUUID(), checkpoint = randomUUID(), initialUser = randomUUID(), nextCheckpoint = randomUUID();
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    const key = body.key ? { sessionId: body.key.session_id } : null;
    const path = String(url).split("/").at(-1);
    let data: unknown;
    switch (path) {
      case "load": data = { entries: await remote.load({ userId, key: key! }) }; break;
      case "append": await remote.append({ userId, key: key!, entries: body.entries, appendBatchId: body.append_batch_id }); data = null; break;
      case "status": data = { state: await remote.getStatus({ userId, sessionId: body.session_id }) }; break;
      case "mark-incomplete": await remote.markIncomplete({ userId, sessionId: body.session_id }); data = { state: "incomplete" }; break;
      case "mark-complete": await remote.markComplete({ userId, sessionId: body.session_id }); data = { state: "complete" }; break;
      default: throw new Error(`unexpected fixture operation: ${path}`);
    }
    return new Response(JSON.stringify({ success: true, data }));
  };
  const makeStore = () => new NativeLiveMacProviderSessionStore("https://local.fixture", "local-only", fetchImpl);
  const key = { projectKey: "/local", sessionId };
  const prefix = [{ type: "user", uuid: initialUser, parentUuid: null, sessionId }, { type: "assistant", uuid: checkpoint, parentUuid: initialUser, sessionId }];
  await makeStore().append(key, prefix);
  await makeStore().markComplete(sessionId);
  const prepare = async (head: string | null) => {
    const prepared = await coordinator.prepare(userId, { dispatch_target: "claude_code", request_id: randomUUID(), conversation_id: conversation.id, operation: "send", expected_head_message_id: head, text: "local fixture" });
    assert.ok(prepared.ok);
    if (!prepared.ok) throw new Error("prepare failed");
    return prepared.command;
  };
  const successfulResult = (command: Awaited<ReturnType<typeof prepare>>, cp: string) => ({ protocol_version: 4 as const, prepare_id: command.prepare_id, request_id: command.request_id, conversation_id: conversation.id, status: "success" as const, provider_session_id: sessionId, provider_checkpoint_id: cp, normalized_events: [{ type: "result" as const, payload: { status: "success", final_text: "fixture answer" } }] });
  const initial = await coordinator.finalize(userId, successfulResult(await prepare(null), checkpoint));
  assert.ok(initial.ok && "assistantMessageId" in initial);
  if (!initial.ok || !("assistantMessageId" in initial)) throw new Error("initial finalize failed");
  const oldHead = initial.assistantMessageId;
  let queryCalls = 0;
  const makeTransport = () => new AgentSdkClaudeTransport({ environment: {}, cwd: "/local", sessionStore: makeStore(), sessionMessagesImpl: async () => [], queryImpl: ({ options }: any) => {
    queryCalls++;
    assert.equal(options.resume, sessionId);
    assert.equal(options.resumeSessionAt, checkpoint);
    assert.equal(options.forkSession, undefined);
    return { close() {}, async *[Symbol.asyncIterator]() {
      yield { type: "system", subtype: "init", session_id: sessionId };
      if (queryCalls === 1) {
        await options.sessionStore.append(key, [{ type: "user", uuid: randomUUID(), parentUuid: checkpoint, sessionId, message: { role: "user", content: "failed tail" } }]);
        throw new Error("provider authentication failed");
      }
      assert.deepEqual(await options.sessionStore.load(key), prefix);
      await options.sessionStore.append(key, [{ type: "assistant", uuid: nextCheckpoint, parentUuid: checkpoint, sessionId }]);
      yield { type: "result", subtype: "success", session_id: sessionId, result: "fixture answer" };
    } };
  } });
  const failed = await prepare(oldHead);
  await assert.rejects(makeTransport().executeTurn("fixture", { mode: "resume", parentProviderSessionId: sessionId, parentProviderCheckpointId: checkpoint, requireProviderCheckpoint: true }), /authentication/u);
  await coordinator.finalize(userId, { protocol_version: 4, prepare_id: failed.prepare_id, request_id: failed.request_id, conversation_id: conversation.id, status: "failure", error_code: "CLAUDE_PROCESS_FAILED" });
  const [afterFailure] = await database.db.select().from(conversations).where(eq(conversations.id, conversation.id));
  assert.equal(afterFailure!.currentHeadMessageId, oldHead);
  assert.equal(await makeStore().getStatus(sessionId), "incomplete");
  const continued = await prepare(oldHead);
  assert.equal(continued.parent_provider_checkpoint_id, checkpoint);
  const recovered = await makeTransport().executeTurn("fixture", { mode: "resume", parentProviderSessionId: sessionId, parentProviderCheckpointId: checkpoint, requireProviderCheckpoint: true });
  assert.equal(recovered.providerSessionId, sessionId);
  assert.equal(recovered.providerCheckpointId, nextCheckpoint);
  const result = successfulResult(continued, recovered.providerCheckpointId);
  const committed = await coordinator.finalize(userId, result);
  const replayed = await coordinator.finalize(userId, result);
  assert.ok(committed.ok && "assistantMessageId" in committed && replayed.ok && "assistantMessageId" in replayed);
  if (!committed.ok || !("assistantMessageId" in committed) || !replayed.ok || !("assistantMessageId" in replayed)) throw new Error("recovery finalize failed");
  assert.equal(replayed.outcome, "idempotent");
  assert.equal(replayed.assistantMessageId, committed.assistantMessageId);
  assert.equal(replayed.checkpointId, committed.checkpointId);
  const [afterRecovery] = await database.db.select().from(conversations).where(eq(conversations.id, conversation.id));
  assert.equal(afterRecovery!.currentHeadMessageId, committed.assistantMessageId);
  const messages = await database.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id));
  assert.equal(messages.filter(message => message.role === "assistant").length, 2, "initial assistant plus exactly one recovery assistant");
  assert.equal(queryCalls, 2, "one failed query, one explicitly requested recovery query; no hidden retries");
  assert.equal(await makeStore().getStatus(sessionId), "incomplete");
  const entries = await makeStore().load(key);
  assert.equal(entries!.filter(entry => entry.uuid === nextCheckpoint).length, 1);
  assert.equal(entries!.length, 4, "canonical prefix, retained failed tail and one new checkpoint");
});
