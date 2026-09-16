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
  ConversationArchiveSearchRecord,
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
  lastSearchInput: Parameters<ConversationArchiveReadRepository["searchMessages"]>[0] | null = null;
  ordinal: { index: number; total: number } | null = { index: 250, total: 400 };

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

  async searchMessages(input: Parameters<ConversationArchiveReadRepository["searchMessages"]>[0]): Promise<{ items: ConversationArchiveSearchRecord[]; total: number }> {
    this.lastSearchInput = input;
    return {
      items: [{
        messageId: "22222222-2222-4222-8222-222222222222",
        conversationId: CONVERSATION_ID,
        provider: "chatgpt",
        conversationTitle: "Example",
        sourceNodeId: "node",
        role: "assistant",
        model: "gpt-5-6",
        sourceCreatedAt: "2026-09-02T00:00:00.000Z",
        isCurrentPath: true,
        displayText: "prefix ".repeat(80) + "needle" + " suffix".repeat(80),
      }],
      total: 1,
    };
  }

  async findMessageOrdinal() {
    return this.ordinal;
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


test("Conversation search validates filters, forwards timezone, and returns a bounded snippet", async () => {
  const repository = new FakeReadRepository();
  const service = new ConversationArchiveReadService(repository);

  const result = await service.search({
    userId: "user",
    query: " needle ",
    provider: "chatgpt",
    role: "assistant",
    conversationId: CONVERSATION_ID,
    from: "2026-09-01",
    to: "2026-09-16",
    timeZone: "Asia/Shanghai",
  });

  assert.equal(repository.lastSearchInput?.query, "needle");
  assert.equal(repository.lastSearchInput?.provider, "chatgpt");
  assert.equal(repository.lastSearchInput?.role, "assistant");
  assert.equal(repository.lastSearchInput?.conversationId, CONVERSATION_ID);
  assert.equal(repository.lastSearchInput?.timeZone, "Asia/Shanghai");
  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
  assert.ok(result.items[0]!.snippet.includes("needle"));
  assert.ok(result.items[0]!.snippet.length <= 362);
  assert.equal("displayText" in result.items[0]!, false);
});

test("Conversation search rejects blank queries and date filters without a valid timezone", async () => {
  const service = new ConversationArchiveReadService(new FakeReadRepository());

  await assert.rejects(
    () => service.search({ userId: "user", query: "   " }),
    (error: unknown) =>
      error instanceof ConversationArchiveReadError
      && error.code === "CONVERSATION_INVALID_REQUEST",
  );

  await assert.rejects(
    () => service.search({
      userId: "user",
      query: "test",
      from: "2026-09-01",
      timeZone: "",
    }),
    (error: unknown) =>
      error instanceof ConversationArchiveReadError
      && error.code === "CONVERSATION_INVALID_REQUEST",
  );
});

test("exact message context computes a bounded offset around the anchor", async () => {
  const repository = new FakeReadRepository();
  repository.listMessages = async (input) => {
    repository.lastMessagesInput = input;
    return { items: [], total: 400 };
  };
  const service = new ConversationArchiveReadService(repository);

  const context = await service.messageContext({
    userId: "user",
    conversationId: CONVERSATION_ID,
    messageId: "22222222-2222-4222-8222-222222222222",
    radius: 20,
  });

  assert.equal(repository.lastMessagesInput?.offset, 230);
  assert.equal(repository.lastMessagesInput?.limit, 41);
  assert.equal(context.offset, 230);
  assert.equal(context.anchorIndex, 20);
  assert.equal(context.total, 400);
});

test("message context returns not-found when the requested anchor is outside the selected view", async () => {
  const repository = new FakeReadRepository();
  repository.ordinal = null;
  const service = new ConversationArchiveReadService(repository);

  await assert.rejects(
    () => service.messageContext({
      userId: "user",
      conversationId: CONVERSATION_ID,
      messageId: "22222222-2222-4222-8222-222222222222",
    }),
    (error: unknown) =>
      error instanceof ConversationArchiveReadError
      && error.code === "CONVERSATION_NOT_FOUND",
  );
});
