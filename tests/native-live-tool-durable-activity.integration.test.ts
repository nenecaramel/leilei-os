import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, nativeLiveTurnPreparations } from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { DrizzleNativeLiveCurrentPathReader } from "../src/domains/conversation/native-live-current-path-read-repository.js";

test("ordinary tools and suppressed descendants survive operational history removal in both ledger readers", { skip: process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST !== "1" }, async t => {
  assert.ok(process.env.DATABASE_URL);
  const database = createDatabase(process.env.DATABASE_URL, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `tool-ledger-${crypto.randomUUID()}@example.test`, displayName: "Tool ledger" }).returning();
  t.after(async () => {
    try {
      await database.db.delete(conversations).where(eq(conversations.userId, user.id));
      await database.db.delete(users).where(eq(users.id, user.id));
    } finally { await database.close(); }
  });
  const repository = new DrizzleNativeLiveConversationRepository(database.db);
  const currentReader = new DrizzleNativeLiveCurrentPathReader(database.db);
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
  for (const flag of [null, "hidden_from_transcript", "hidden_from_activity"] as const) {
    const conversation = await repository.createConversation({ userId: user.id });
    const prepared = await coordinator.prepare(user.id, { dispatch_target: "claude_code", request_id: crypto.randomUUID(), operation: "send", conversation_id: conversation.id, expected_head_message_id: null, text: "Read a file" });
    assert.ok(prepared.ok);
    if (!prepared.ok) throw new Error("prepare failed");
    const command = prepared.command;
    const use = { tool_use_id: "read1", tool_name: "Read", input: { path: "src/example.ts" }, parent_tool_use_id: "parent", parent_agent_id: "agent1", provenance: { provider: "claude_code", raw_type: "tool_use", tool_use_id: "read1" } };
    const result = { tool_use_id: "read1", output: "file contents", is_error: false, provenance: { provider: "claude_code", raw_type: "tool_result", tool_use_id: "read1" } };
    const finalized = await coordinator.finalize(user.id, {
      protocol_version: 3, prepare_id: command.prepare_id, request_id: command.request_id,
      conversation_id: conversation.id, status: "success", provider_session_id: `ledger-${crypto.randomUUID()}`,
      normalized_events: [
        ...(flag ? [{ type: "task" as const, payload: { tool_use_id: "parent", ...(flag === "hidden_from_transcript" ? { hidden_from_transcript: true } : { ambient: true }) } }] : []),
        { type: "tool_use", payload: { ...use, display_name: "Read file", server_display_name: "Server", icon_url: "icon" } },
        { type: "tool_result", payload: result },
        { type: "text", payload: { text: "Assistant answer" } },
      ],
    });
    assert.ok(finalized.ok);
    await database.db.delete(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, command.prepare_id));
    const views = [
      await repository.getConversation({ userId: user.id, conversationId: conversation.id }),
      await currentReader.readCurrentPath({ userId: user.id, conversationId: conversation.id, limit: 100 }),
    ];
    for (const view of views) {
      const assistant = view?.messages.find(message => message.role === "assistant");
      assert.ok(assistant);
      assert.deepEqual(assistant.blocks.map(block => block.kind), ["tool_use", "tool_result", "text"]);
      assert.deepEqual(assistant.blocks[0].payload, { ...use, ...(flag ? { [flag]: true } : {}) });
      assert.deepEqual(assistant.blocks[1].payload, result);
      assert.equal(assistant.blocks[2].text, "Assistant answer");
    }
  }
});
