import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversationContentBlocks,
  conversationProviderSessionCheckpoints,
  conversations,
  users,
  nativeLiveChatAttachments,
} from "../src/database/schema.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { DrizzleNativeLiveCurrentPathReader } from "../src/domains/conversation/native-live-current-path-read-repository.js";
import { DrizzleNativeLiveAttachmentBinding } from "../src/domains/bridge/attachment/native-live-attachment-service.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";

test(
  "canonical extension and legacy content roundtrip through both real database readers",
  { skip: process.env.RUN_NATIVE_LIVE_CONVERSATION_DATABASE_TEST !== "1" },
  async (t) => {
    assert.ok(process.env.DATABASE_URL);
    const database = createDatabase(process.env.DATABASE_URL, { ssl: false });
    const [user] = await database.db
      .insert(users)
      .values({
        email: `contract-${crypto.randomUUID()}@example.test`,
        displayName: "Contract fixture",
      })
      .returning({ id: users.id });
    assert.ok(user);
    t.after(async () => {
      try {
        await database.db
          .delete(conversations)
          .where(eq(conversations.userId, user.id));
        await database.db.delete(nativeLiveChatAttachments).where(eq(nativeLiveChatAttachments.userId, user.id));
        await database.db.delete(users).where(eq(users.id, user.id));
      } finally {
        await database.close();
      }
    });
    const repository = new DrizzleNativeLiveConversationRepository(database.db);
    const service = new NativeLiveConversationService(repository);
    const conversation = await service.createConversation({ userId: user.id });
    const parent = await service.appendUserMessage({
      userId: user.id,
      conversationId: conversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", text: "fixture" }],
    });
    const attachmentId = crypto.randomUUID();
    await database.db.insert(nativeLiveChatAttachments).values({
      id: attachmentId, userId: user.id, objectKey: `contract/${attachmentId}`,
      filename: "user.pdf", mimeType: "application/pdf", sizeBytes: 3,
      sha256: "a".repeat(64), kind: "file", status: "ready",
      readyAt: new Date(), expiresAt: new Date(Date.now() + 60000),
    });
    await new DrizzleNativeLiveAttachmentBinding(database.db).bindReadyToMessage({
      userId: user.id, messageId: parent.id, attachmentIds: [attachmentId],
    });
    const turn = await service.completeAssistantTurn({
      userId: user.id,
      conversationId: conversation.id,
      parentMessageId: parent.id,
      blocks: [
        { kind: "text", text: "hello" },
        { kind: "tool_use", payload: { tool_use_id: "legacy" } },
        {
          kind: "tool_result",
          payload: { tool_use_id: "legacy", output: "old" },
        },
        {
          kind: "canonical_tool_result",
          payload: {
            schema_version: 1,
            identity: "canonical_tool_result",
            refs: [],
            structured: { parts: [{ type: "json", value: { answer: 42 } }] },
          },
        },
        {
          kind: "artifact",
          payload: {
            schema_version: 1,
            identity: "artifact",
            refs: [
              { type: "artifact_ref", entity_id: "reserved-artifact-fixture" },
            ],
          },
        },
        {
          kind: "resource",
          payload: {
            schema_version: 1,
            identity: "resource",
            refs: [
              { type: "resource_ref", entity_id: "reserved-resource-fixture" },
            ],
          },
        },
        {
          kind: "unknown",
          rawType: "future_widget",
          payload: {
            schema_version: 1,
            diagnostic_code: "UNSUPPORTED_PROVIDER_CONTENT",
            provenance: { provider: "claude_code", raw_type: "future_widget" },
            compatibility: { answer: 42 },
          },
        },
      ],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: "fixture-session",
        runtimeMetadata: {
          context_usage: null,
          result: {
            structured_output: { schema_version: 1, payload: { answer: 42 } },
          },
        },
      },
    });
    await database.db.insert(conversationContentBlocks).values({
      userId: user.id,
      messageId: turn.message.id,
      ordinal: 7,
      kind: "thinking",
      rawType: "thinking",
      text: "SECRET",
      payload: { thinking: "SECRET" },
    });
    const stored = await database.db
      .select({ kind: conversationContentBlocks.kind })
      .from(conversationContentBlocks)
      .where(eq(conversationContentBlocks.messageId, turn.message.id));
    assert.equal(stored.filter((row) => row.kind === "unknown").length, 4);
    const complete = await repository.getConversation({
      userId: user.id,
      conversationId: conversation.id,
    });
    const current = await new DrizzleNativeLiveCurrentPathReader(
      database.db,
    ).readCurrentPath({
      userId: user.id,
      conversationId: conversation.id,
      limit: 100,
    });
    for (const view of [complete, current]) {
      assert.ok(view);
      const userAttachment = view.messages.find(message => message.id === parent.id)?.blocks.find(block => block.kind === "attachment");
      assert.ok(userAttachment);
      const source = userAttachment.payload?.provenance as Record<string, unknown>;
      assert.equal(source.origin, "user_send");
      assert.equal(source.raw_type, "user_attachment");
      assert.equal(source.provider, undefined);
      const assistant = view.messages.find(
        (message) => message.id === turn.message.id,
      )!;
      assert.deepEqual(
        assistant.blocks.map((block) => block.kind),
        [
          "text",
          "tool_use",
          "tool_result",
          "canonical_tool_result",
          "artifact",
          "resource",
          "unknown",
          "unknown",
        ],
      );
      assert.equal(
        assistant.blocks[3].payload?.identity,
        "canonical_tool_result",
      );
      assert.ok(!JSON.stringify(assistant).includes("SECRET"));
      assert.equal(
        assistant.blocks[7].payload?.diagnostic_code,
        "HIDDEN_REASONING_EXCLUDED",
      );
    }
    const checkpoint = await service.getProviderCheckpointForHead({
      userId: user.id,
      conversationId: conversation.id,
      canonicalMessageId: turn.message.id,
    });
    assert.ok(checkpoint);
    const [durable] = await database.db
      .select({
        metadata: conversationProviderSessionCheckpoints.runtimeMetadata,
      })
      .from(conversationProviderSessionCheckpoints)
      .where(
        eq(
          conversationProviderSessionCheckpoints.canonicalMessageId,
          turn.message.id,
        ),
      );
    assert.equal(
      (
        (
          (durable?.metadata?.result as Record<string, unknown>)
            ?.structured_output as Record<string, unknown>
        )?.payload as Record<string, unknown>
      )?.answer,
      42,
    );
  },
);
