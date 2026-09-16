import assert from "node:assert/strict";
import test from "node:test";
import {
  ConversationArchiveReadError,
  ConversationArchiveReadService,
} from "../src/domains/conversation/conversation-archive-read-service.js";
import type {
  ConversationArchiveReadRepository,
  ConversationArchiveListItem,
  ConversationArchiveDetail,
  ConversationArchiveMessage,
  ConversationDailyStat,
} from "../src/domains/conversation/conversation-archive-read-repository.js";

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";

class FakeReadRepository implements ConversationArchiveReadRepository {
  status: "active" | "disabled" | null = "active";
  detailValue: ConversationArchiveDetail | null = {
    id: CONVERSATION_ID,
    provider: "chatgpt",
    sourceConversationId: "source-conversation",
    title: "Example",
    sourceCreatedAt: "2026-09-01T00:00:00.000Z",
    sourceUpdatedAt: "2026-09-02T00:00:00.000Z",
    defaultModel: "gpt-5-6",
    currentLeafSourceNodeId: "leaf",
    messageCount: 2,
    turnCount: 1,
    totalNodeCount: 4,
    providerMetadata: {},
  };
  lastStatsInput: Parameters<ConversationArchiveReadRepository["dailyStats"]>[0] | null = null;
  lastMessagesInput: Parameters<ConversationArchiveReadRepository["listMessages"]>[0] | null = null;

  async findUserStatus() { return this.status; }

  async listConversations(): Promise<{ items: ConversationArchiveListItem[]; total: number }> {
    return {
      items: this.detailValue ? [this.detailValue] : [],
      total: this.detailValue ? 1 : 0,
    };
  }

  async getConversation() {
    return this.detailValue;
  }

  async listMessages(input: Parameters<ConversationArchiveReadRepository["listMessages"]>[0]): Promise<{ items: ConversationArchiveMessage[]; total: number }> {
    this.lastMessagesInput = input;
    return { items: [], total: 0 };
  }

  async dailyStats(input: Parameters<ConversationArchiveReadRepository["dailyStats"]>[0]): Promise<ConversationDailyStat[]> {
    this.lastStatsInput = input;
    return [];
  }
}

test("Conversation read service keeps provider-specific default message semantics in the repository contract", async () => {
  const repository = new FakeReadRepository();
  const service = new ConversationArchiveReadService(repository);

  await service.messages({
    userId: "user",
    conversationId: CONVERSATION_ID,
  });
  assert.equal(repository.lastMessagesInput?.provider, "chatgpt");
  assert.equal(repository.lastMessagesInput?.view, "default");

  repository.detailValue = {
    ...repository.detailValue!,
    provider: "claude",
    currentLeafSourceNodeId: null,
    defaultModel: null,
  };
  await service.messages({
    userId: "user",
    conversationId: CONVERSATION_ID,
  });
  assert.equal(repository.lastMessagesInput?.provider, "claude");
  assert.equal(repository.lastMessagesInput?.view, "default");
});

test("Conversation daily stats require an explicit valid IANA timezone", async () => {
  const repository = new FakeReadRepository();
  const service = new ConversationArchiveReadService(repository);

  await service.stats({
    userId: "user",
    from: "2026-09-01",
    to: "2026-09-16",
    timeZone: "Asia/Shanghai",
  });
  assert.equal(repository.lastStatsInput?.timeZone, "Asia/Shanghai");

  await assert.rejects(
    () => service.stats({
      userId: "user",
      from: "2026-09-01",
      to: "2026-09-16",
      timeZone: "Not/A_Real_Zone",
    }),
    (error: unknown) =>
      error instanceof ConversationArchiveReadError
      && error.code === "CONVERSATION_INVALID_REQUEST",
  );
});

test("Conversation daily stats reject reversed and oversized date ranges", async () => {
  const service = new ConversationArchiveReadService(new FakeReadRepository());

  await assert.rejects(
    () => service.stats({
      userId: "user",
      from: "2026-09-16",
      to: "2026-09-01",
      timeZone: "UTC",
    }),
    (error: unknown) =>
      error instanceof ConversationArchiveReadError
      && error.code === "CONVERSATION_INVALID_REQUEST",
  );

  await assert.rejects(
    () => service.stats({
      userId: "user",
      from: "2025-01-01",
      to: "2026-09-16",
      timeZone: "UTC",
    }),
    (error: unknown) =>
      error instanceof ConversationArchiveReadError
      && error.code === "CONVERSATION_INVALID_REQUEST",
  );
});

test("Conversation read service enforces active-user ownership and not-found semantics", async () => {
  const repository = new FakeReadRepository();
  const service = new ConversationArchiveReadService(repository);

  repository.status = "disabled";
  await assert.rejects(
    () => service.list({ userId: "user" }),
    (error: unknown) =>
      error instanceof ConversationArchiveReadError
      && error.code === "CONVERSATION_UNAVAILABLE",
  );

  repository.status = "active";
  repository.detailValue = null;
  await assert.rejects(
    () => service.detail({ userId: "user", conversationId: CONVERSATION_ID }),
    (error: unknown) =>
      error instanceof ConversationArchiveReadError
      && error.code === "CONVERSATION_NOT_FOUND",
  );
});
