import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversationMessages,
  conversationProviderSessionCheckpoints,
  conversations,
  users,
} from "../src/database/schema.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";

const enabled =
  process.env.RUN_NATIVE_LIVE_CONVERSATION_DATABASE_TEST === "1";

test(
  "native live conversation persistence keeps immutable branches, exact checkpoints, tenant isolation, and assistant atomicity",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl);
    t.after(async () => database.close());

    const suffix = crypto.randomUUID();
    const createdUsers = await database.db
      .insert(users)
      .values([
        {
          email: `native-live-a-${suffix}@example.com`,
          displayName: "Native Live A",
        },
        {
          email: `native-live-b-${suffix}@example.com`,
          displayName: "Native Live B",
        },
      ])
      .returning({ id: users.id });
    assert.equal(createdUsers.length, 2);
    const userA = createdUsers[0]!.id;
    const userB = createdUsers[1]!.id;

    t.after(async () => {
      await database.db.delete(users).where(eq(users.id, userA));
      await database.db.delete(users).where(eq(users.id, userB));
    });

    const repository = new DrizzleNativeLiveConversationRepository(database.db);
    const service = new NativeLiveConversationService(repository);

    const conversation = await service.createConversation({
      userId: userA,
      title: "Native live test",
    });
    assert.equal(conversation.currentHeadMessageId, null);

    const userMessage = await service.appendUserMessage({
      userId: userA,
      conversationId: conversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", text: "hello" }],
    });

    const first = await service.completeAssistantTurn({
      userId: userA,
      conversationId: conversation.id,
      parentMessageId: userMessage.id,
      blocks: [{ kind: "text", text: "first" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: "frozen-session-1",
        providerCheckpointId: "checkpoint-1",
      },
    });

    const second = await service.completeAssistantTurn({
      userId: userA,
      conversationId: conversation.id,
      parentMessageId: userMessage.id,
      blocks: [{ kind: "text", text: "retry sibling" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: "frozen-session-2",
        providerCheckpointId: "checkpoint-2",
      },
    });

    const stored = await service.getConversation({
      userId: userA,
      conversationId: conversation.id,
    });
    assert.ok(stored);
    assert.equal(stored.messages.length, 3);
    assert.equal(stored.currentHeadMessageId, second.message.id);

    await service.setCurrentHead({
      userId: userA,
      conversationId: conversation.id,
      messageId: first.message.id,
    });
    const switched = await service.getConversation({
      userId: userA,
      conversationId: conversation.id,
    });
    assert.equal(switched?.currentHeadMessageId, first.message.id);

    const firstCheckpoint = await service.getProviderCheckpointForHead({
      userId: userA,
      conversationId: conversation.id,
      canonicalMessageId: first.message.id,
    });
    const secondCheckpoint = await service.getProviderCheckpointForHead({
      userId: userA,
      conversationId: conversation.id,
      canonicalMessageId: second.message.id,
    });
    assert.equal(firstCheckpoint?.providerSessionId, "frozen-session-1");
    assert.equal(secondCheckpoint?.providerSessionId, "frozen-session-2");

    const crossUser = await service.getConversation({
      userId: userB,
      conversationId: conversation.id,
    });
    assert.equal(crossUser, null);
    await assert.rejects(
      service.setCurrentHead({
        userId: userB,
        conversationId: conversation.id,
        messageId: first.message.id,
      }),
      /not found/i,
    );

    const failedUserMessage = await service.appendUserMessage({
      userId: userA,
      conversationId: conversation.id,
      parentMessageId: first.message.id,
      blocks: [{ kind: "text", text: "cause checkpoint failure" }],
    });

    const beforeFailure = await database.db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id));

    await assert.rejects(
      service.completeAssistantTurn({
        userId: userA,
        conversationId: conversation.id,
        parentMessageId: failedUserMessage.id,
        blocks: [{ kind: "text", text: "must roll back" }],
        checkpoint: {
          provider: "claude_code",
          providerSessionId: "",
        },
      }),
    );

    const afterFailure = await database.db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id));
    assert.equal(afterFailure.length, beforeFailure.length);

    const heads = await database.db
      .select({ currentHeadMessageId: conversations.currentHeadMessageId })
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    assert.equal(heads[0]?.currentHeadMessageId, first.message.id);

    const checkpoints = await database.db
      .select({ id: conversationProviderSessionCheckpoints.id })
      .from(conversationProviderSessionCheckpoints)
      .where(
        eq(
          conversationProviderSessionCheckpoints.conversationId,
          conversation.id,
        ),
      );
    assert.equal(checkpoints.length, 2);
  },
);
