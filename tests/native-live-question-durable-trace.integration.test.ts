import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, nativeLiveRuntimeInteractions, nativeLiveTurnPreparations } from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";

test("canonical question resolution survives removal of all operational turn history", { skip: process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST !== "1" }, async (t) => {
  assert.ok(process.env.DATABASE_URL);
  const database = createDatabase(process.env.DATABASE_URL, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `question-${crypto.randomUUID()}@example.com`, displayName: "Question trace" }).returning();
  assert.ok(user);
  t.after(async () => {
    await database.db.delete(conversations).where(eq(conversations.userId, user.id));
    await database.db.delete(users).where(eq(users.id, user.id));
    await database.close();
  });
  const repository = new DrizzleNativeLiveConversationRepository(database.db);
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
  for (const response of [{ decision: "answer", answers: { "Theme?": "Dark" } }, { decision: "cancel", message: "Dismissed" }]) {
    const conversation = await repository.createConversation({ userId: user.id, title: "Durable question" });
    const requestId = crypto.randomUUID();
    const prepared = await coordinator.prepare(user.id, { dispatch_target: "claude_code", request_id: requestId, operation: "send", conversation_id: conversation.id, expected_head_message_id: null, text: "Ask a question" });
    assert.ok(prepared.ok, JSON.stringify(prepared));
    if (!prepared.ok) throw new Error("prepare failed");
    const command = prepared.command;
    await database.db.insert(nativeLiveRuntimeInteractions).values({ id: crypto.randomUUID(), userId: user.id, prepareId: command.prepare_id, listenerInstanceId: crypto.randomUUID(), kind: "question", request: { toolUseId: "q1" }, status: "resolved", response, resolvedAt: new Date() });
    const result = { protocol_version: 3, prepare_id: command.prepare_id, request_id: requestId, conversation_id: conversation.id, status: "success", provider_session_id: `question-session-${requestId}`, normalized_events: [
      { type: "tool_use", payload: { tool_use_id: "q1", tool_name: "AskUserQuestion", parent_tool_use_id: "task1", input: { questions: [{ question: "Theme?", header: "Theme", options: [{ label: "Dark" }] }] } } },
      { type: "tool_result", payload: { tool_use_id: "q1", output: "opaque provider text", is_error: response.decision === "cancel" } },
      { type: "text", payload: { text: "Done" } },
      { type: "result", payload: { status: "success", final_text: "Done" } },
    ] };
    const finalized = await coordinator.finalize(user.id, result);
    assert.ok(finalized.ok);
    // A replay reads the committed blocks rather than depending on live interaction rows.
    await database.db.delete(nativeLiveRuntimeInteractions).where(eq(nativeLiveRuntimeInteractions.prepareId, command.prepare_id));
    const replay = await coordinator.finalize(user.id, result);
    assert.ok(replay.ok);
    await database.db.delete(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, command.prepare_id));
    const read = await repository.getConversation({ userId: user.id, conversationId: conversation.id });
    const assistant = read?.messages.find((message) => message.role === "assistant");
    assert.ok(assistant);
    const toolUse = assistant.blocks.find((block) => block.kind === "tool_use");
    assert.equal(toolUse?.payload?.tool_name, "AskUserQuestion");
    assert.equal(toolUse?.payload?.parent_tool_use_id, "task1");
    const toolResult = assistant.blocks.find((block) => block.kind === "tool_result");
    assert.deepEqual(toolResult?.payload?.question_activity, response.decision === "answer" ? { kind: "question", resolution: "answered", answers: { "Theme?": "Dark" } } : { kind: "question", resolution: "cancelled", message: "Dismissed" });
    assert.equal(toolResult?.payload?.output, "opaque provider text");
    assert.equal(assistant.blocks.filter((block) => block.kind === "tool_use").length, 1);
  }
});
