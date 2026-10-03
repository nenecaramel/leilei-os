import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClaudeEvents } from "../tools/claude-bridge/src/normalized-events.mjs";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, nativeLiveTurnPreparations, conversationProviderSessionCheckpoints } from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { DrizzleNativeLiveCurrentPathReader } from "../src/domains/conversation/native-live-current-path-read-repository.js";
import { readNativeLiveMessageActivityByAssistantMessage } from "../src/domains/conversation/native-live-message-activity-read-repository.js";

test("current-path reuses durable checkpoint duration through refresh and operational retention without another write", { skip: process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST !== "1" }, async (t) => {
  assert.ok(process.env.DATABASE_URL);
  const database = createDatabase(process.env.DATABASE_URL, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `activity-${crypto.randomUUID()}@example.com`, displayName: "Activity finish" }).returning();
  assert.ok(user);
  t.after(async () => {
    await database.db.delete(conversations).where(eq(conversations.userId, user.id));
    await database.db.delete(users).where(eq(users.id, user.id));
    await database.close();
  });
  const repository = new DrizzleNativeLiveConversationRepository(database.db);
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
  const conversation = await repository.createConversation({ userId: user.id, title: "Activity duration" });
  const requestId = crypto.randomUUID();
  const prepared = await coordinator.prepare(user.id, { dispatch_target: "claude_code", request_id: requestId, operation: "send", conversation_id: conversation.id, expected_head_message_id: null, text: "Edit" });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  if (!prepared.ok) throw new Error("prepare failed");
  const command = prepared.command;
  const providerResult = normalizeClaudeEvents([
    { type: "result", subtype: "success", session_id: `activity-${requestId}`, result: "Done", duration_ms: 18000 },
  ], { logicalConversationId: conversation.id, mode: "new" }).find((event: { type: string }) => event.type === "result");
  assert.ok(providerResult);
  const finalized = await coordinator.finalize(user.id, {
    protocol_version: 3, prepare_id: command.prepare_id, request_id: requestId, conversation_id: conversation.id, status: "success", provider_session_id: `activity-${requestId}`,
    normalized_events: [
      { type: "tool_use", payload: { tool_use_id: "edit1", tool_name: "Edit", input: {} } },
      { type: "tool_result", payload: { tool_use_id: "edit1", output: "ok" } },
      { type: "text", payload: { text: "Done" } },
      providerResult,
    ],
    runtime_metadata: { context_usage: null, result: providerResult.payload.telemetry },
  });
  assert.ok(finalized.ok);
  if (!finalized.ok) throw new Error("finalize failed");
  const [checkpoint] = await database.db.select({ runtimeMetadata: conversationProviderSessionCheckpoints.runtimeMetadata }).from(conversationProviderSessionCheckpoints).where(eq(conversationProviderSessionCheckpoints.canonicalMessageId, finalized.assistantMessageId));
  assert.equal((checkpoint?.runtimeMetadata?.result as { duration_ms: number })?.duration_ms, 18000);
  const reader = new DrizzleNativeLiveCurrentPathReader(database.db);
  const input = { userId: user.id, conversationId: conversation.id, limit: 100 };
  const before = await reader.readCurrentPath(input);
  const assistant = before?.messages.find((message) => message.id === finalized.assistantMessageId);
  assert.equal(assistant?.activity?.durationMs, 18000);
  assert.equal(assistant?.activity?.prepareId, command.prepare_id);
  assert.deepEqual(assistant?.blocks.map((block) => block.kind), ["tool_use", "tool_result", "text"]);
  const refreshed = await new DrizzleNativeLiveCurrentPathReader(database.db).readCurrentPath(input);
  assert.equal(refreshed?.messages.at(-1)?.activity?.durationMs, 18000);
  await database.db.delete(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, command.prepare_id));
  const expired = await reader.readCurrentPath(input);
  assert.deepEqual(expired?.messages.at(-1)?.activity, { prepareId: null, durationMs: 18000, events: [], interactions: [] });
  const foreign = await readNativeLiveMessageActivityByAssistantMessage(database.db, { ...input, userId: crypto.randomUUID(), messageRows: [{ id: finalized.assistantMessageId, role: "assistant" }] });
  assert.equal(foreign.size, 0);
  const otherConversation = await readNativeLiveMessageActivityByAssistantMessage(database.db, { ...input, conversationId: crypto.randomUUID(), messageRows: [{ id: finalized.assistantMessageId, role: "assistant" }] });
  assert.equal(otherConversation.size, 0);
  for (const metadata of [null, {}, { result: {} }, { result: { duration_ms: null } }, { result: { duration_ms: -1 } }, { result: { duration_ms: "18000" } }]) {
    await database.db.update(conversationProviderSessionCheckpoints).set({ runtimeMetadata: metadata }).where(eq(conversationProviderSessionCheckpoints.canonicalMessageId, finalized.assistantMessageId));
    const old = await reader.readCurrentPath(input);
    assert.equal(old?.messages.at(-1)?.activity, null);
  }
});
