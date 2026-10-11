import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { normalizeClaudeEvents } from "../tools/claude-bridge/src/normalized-events.mjs";
import { createDatabase } from "../src/database/client.js";
import {
  users,
  conversations,
  nativeLiveRuntimeEvents,
} from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { DrizzleNativeLiveCurrentPathReader } from "../src/domains/conversation/native-live-current-path-read-repository.js";

test("completed turns preserve only explicitly user-visible thinking in canonical activity", {
  skip: process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST !== "1",
}, async t => {
  assert.ok(process.env.DATABASE_URL);
  const database = createDatabase(process.env.DATABASE_URL!, { ssl: false });
  const [user] = await database.db.insert(users).values({
    email: `thinking-${crypto.randomUUID()}@example.test`,
    displayName: "Visible thinking",
  }).returning();
  assert.ok(user);
  t.after(async () => {
    await database.db.delete(conversations).where(eq(conversations.userId, user.id));
    await database.db.delete(users).where(eq(users.id, user.id));
    await database.close();
  });

  const repository = new DrizzleNativeLiveConversationRepository(database.db);
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
  const reader = new DrizzleNativeLiveCurrentPathReader(database.db);
  const conversation = await repository.createConversation({ userId: user.id, title: "Thinking" });
  const prepared = await coordinator.prepare(user.id, {
    dispatch_target: "claude_code",
    request_id: crypto.randomUUID(),
    operation: "send",
    conversation_id: conversation.id,
    expected_head_message_id: null,
    text: "Explain this",
  });
  assert.ok(prepared.ok);
  if (!prepared.ok) throw new Error("Preparation failed");
  const command = prepared.command;
  const providerSessionId = `thinking-${crypto.randomUUID()}`;
  const providerResult = normalizeClaudeEvents([{
    type: "result", subtype: "success", session_id: providerSessionId,
    result: "Explanation", duration_ms: 3500,
  }], { logicalConversationId: conversation.id, mode: "new" })
    .find(event => event.type === "result");
  assert.ok(providerResult);

  const finalized = await coordinator.finalize(user.id, {
    protocol_version: 4,
    prepare_id: command.prepare_id,
    request_id: command.request_id,
    conversation_id: conversation.id,
    status: "success",
    provider_session_id: providerSessionId,
    normalized_events: [
      { type: "text", payload: { text: "Explanation" } },
      providerResult,
    ],
  });
  assert.ok(finalized.ok);
  if (!finalized.ok) throw new Error("Finalization failed");

  await database.db.insert(nativeLiveRuntimeEvents).values([
    { userId: user.id, prepareId: command.prepare_id, sequence: 1,
      eventType: "runtime", payload: { kind: "provider_message_start" } },
    { userId: user.id, prepareId: command.prepare_id, sequence: 2,
      eventType: "runtime",
      payload: { kind: "user_visible_thinking", text: "Inspecting the options.", source_uuid: "a1", content_index: 0 } },
    { userId: user.id, prepareId: command.prepare_id, sequence: 3,
      eventType: "runtime", payload: { kind: "provider_observability", compatibility: { signature: "not-for-display" } } },
    { userId: user.id, prepareId: command.prepare_id, sequence: 4,
      eventType: "task", payload: { task_id: "t1", phase: "start" } },
    { userId: user.id, prepareId: command.prepare_id, sequence: 5,
      eventType: "runtime",
      payload: { kind: "user_visible_thinking", text: "Checking the conclusion.", source_uuid: "a2", content_index: 0 } },
  ]);

  const current = await reader.readCurrentPath({ userId: user.id, conversationId: conversation.id, limit: 100 });
  const assistant = current?.messages.find(message => message.id === finalized.assistantMessageId);
  assert.ok(assistant?.activity);
  const events = assistant.activity.events;
  assert.deepEqual(events.map(entry => entry.sequence), [2, 4, 5]);
  assert.deepEqual(events.filter(entry => entry.event.type === "runtime").map(entry => entry.event.payload?.text), [
    "Inspecting the options.", "Checking the conclusion.",
  ]);
  assert.deepEqual(assistant.blocks.map(block => block.kind), ["text"]);
});
