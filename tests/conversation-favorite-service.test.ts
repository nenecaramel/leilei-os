import assert from "node:assert/strict";
import test from "node:test";
import {
  ConversationFavoriteError,
  ConversationFavoriteService,
} from "../src/domains/conversation/conversation-favorite-service.js";
import type {
  ConversationFavoriteDetail,
  ConversationFavoriteListItem,
  ConversationFavoriteRepository,
} from "../src/domains/conversation/conversation-favorite-repository.js";

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const START_ID = "22222222-2222-4222-8222-222222222222";
const END_ID = "33333333-3333-4333-8333-333333333333";
const FAVORITE_ID = "44444444-4444-4444-8444-444444444444";

function detail(): ConversationFavoriteDetail {
  return {
    id: FAVORITE_ID,
    provider: "chatgpt",
    sourceConversationId: "source-conversation",
    conversationId: CONVERSATION_ID,
    view: "all",
    title: "Favorite",
    note: "Note",
    tags: ["Important"],
    conversationTitleSnapshot: "Conversation",
    startMessageId: START_ID,
    endMessageId: END_ID,
    startSourceNodeId: "start-node",
    endSourceNodeId: "end-node",
    messageCount: 2,
    canonicalConversationExists: true,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    messages: [
      {
        ordinal: 0,
        messageId: START_ID,
        sourceNodeId: "start-node",
        sourceMessageId: null,
        role: "user",
        model: null,
        sourceCreatedAt: "2026-09-16T00:00:00.000Z",
        displayText: "hello",
        snapshot: { version: 1 },
        canonicalMessageExists: true,
      },
      {
        ordinal: 1,
        messageId: END_ID,
        sourceNodeId: "end-node",
        sourceMessageId: null,
        role: "assistant",
        model: "gpt-5-6",
        sourceCreatedAt: "2026-09-16T00:00:01.000Z",
        displayText: "world",
        snapshot: { version: 1 },
        canonicalMessageExists: true,
      },
    ],
  };
}

class FakeRepository implements ConversationFavoriteRepository {
  status: "active" | "disabled" | null = "active";
  favorite: ConversationFavoriteDetail | null = detail();
  createInput: Parameters<ConversationFavoriteRepository["createFavorite"]>[0] | null = null;
  listInput: Parameters<ConversationFavoriteRepository["listFavorites"]>[0] | null = null;
  updateInput: Parameters<ConversationFavoriteRepository["updateFavorite"]>[0] | null = null;
  deleteResult = true;
  createError: string | null = null;

  async findUserStatus() { return this.status; }

  async createFavorite(input: Parameters<ConversationFavoriteRepository["createFavorite"]>[0]) {
    this.createInput = input;
    if (this.createError) {
      throw Object.assign(new Error(this.createError), { code: this.createError });
    }
    return FAVORITE_ID;
  }

  async listFavorites(input: Parameters<ConversationFavoriteRepository["listFavorites"]>[0]): Promise<{ items: ConversationFavoriteListItem[]; total: number }> {
    this.listInput = input;
    return {
      items: this.favorite ? [this.favorite] : [],
      total: this.favorite ? 1 : 0,
    };
  }

  async getFavorite() {
    return this.favorite;
  }

  async updateFavorite(input: Parameters<ConversationFavoriteRepository["updateFavorite"]>[0]) {
    this.updateInput = input;
    return Boolean(this.favorite);
  }

  async deleteFavorite() {
    return this.deleteResult;
  }
}

test("Conversation favorite create supports a range, normalized metadata, and case-insensitive tag dedupe", async () => {
  const repository = new FakeRepository();
  const service = new ConversationFavoriteService(repository);

  const result = await service.create({
    userId: "user",
    conversationId: CONVERSATION_ID,
    startMessageId: START_ID,
    endMessageId: END_ID,
    view: "all",
    title: "  Favorite  ",
    note: "  Note  ",
    tags: [" Important ", "important", "另一个"],
  });

  assert.equal(result.id, FAVORITE_ID);
  assert.deepEqual(repository.createInput, {
    userId: "user",
    conversationId: CONVERSATION_ID,
    startMessageId: START_ID,
    endMessageId: END_ID,
    view: "all",
    title: "Favorite",
    note: "Note",
    tags: ["Important", "另一个"],
  });
});

test("single-message favorite defaults end to start and default view", async () => {
  const repository = new FakeRepository();
  const service = new ConversationFavoriteService(repository);

  await service.create({
    userId: "user",
    conversationId: CONVERSATION_ID,
    startMessageId: START_ID,
  });

  assert.equal(repository.createInput?.endMessageId, START_ID);
  assert.equal(repository.createInput?.view, "default");
  assert.deepEqual(repository.createInput?.tags, []);
});

test("favorite range repository errors map to stable service-domain errors", async () => {
  const repository = new FakeRepository();
  const service = new ConversationFavoriteService(repository);

  repository.createError = "CONVERSATION_FAVORITE_RANGE_TOO_LARGE";
  await assert.rejects(
    () => service.create({
      userId: "user",
      conversationId: CONVERSATION_ID,
      startMessageId: START_ID,
      endMessageId: END_ID,
    }),
    (error: unknown) =>
      error instanceof ConversationFavoriteError
      && error.code === "CONVERSATION_FAVORITE_RANGE_TOO_LARGE",
  );

  repository.createError = "CONVERSATION_FAVORITE_RANGE_NOT_FOUND";
  await assert.rejects(
    () => service.create({
      userId: "user",
      conversationId: CONVERSATION_ID,
      startMessageId: START_ID,
      endMessageId: END_ID,
    }),
    (error: unknown) =>
      error instanceof ConversationFavoriteError
      && error.code === "CONVERSATION_FAVORITE_NOT_FOUND",
  );
});

test("favorite list validates provider/conversation/tag filters and bounded pagination", async () => {
  const repository = new FakeRepository();
  const service = new ConversationFavoriteService(repository);

  await service.list({
    userId: "user",
    provider: "claude",
    conversationId: CONVERSATION_ID,
    tag: " Important ",
    limit: "25",
    offset: "5",
  });

  assert.deepEqual(repository.listInput, {
    userId: "user",
    provider: "claude",
    conversationId: CONVERSATION_ID,
    tag: "Important",
    limit: 25,
    offset: 5,
  });
});

test("favorite metadata update uses partial semantics and null clears text", async () => {
  const repository = new FakeRepository();
  const service = new ConversationFavoriteService(repository);

  await service.update({
    userId: "user",
    favoriteId: FAVORITE_ID,
    title: null,
    tags: [],
  });

  assert.deepEqual(repository.updateInput, {
    userId: "user",
    favoriteId: FAVORITE_ID,
    title: null,
    tags: [],
  });

  await assert.rejects(
    () => service.update({
      userId: "user",
      favoriteId: FAVORITE_ID,
    }),
    (error: unknown) =>
      error instanceof ConversationFavoriteError
      && error.code === "CONVERSATION_FAVORITE_INVALID_REQUEST",
  );
});

test("favorites enforce active-user access and not-found delete/detail semantics", async () => {
  const repository = new FakeRepository();
  const service = new ConversationFavoriteService(repository);

  repository.status = "disabled";
  await assert.rejects(
    () => service.list({ userId: "user" }),
    (error: unknown) =>
      error instanceof ConversationFavoriteError
      && error.code === "CONVERSATION_FAVORITE_UNAVAILABLE",
  );

  repository.status = "active";
  repository.favorite = null;
  await assert.rejects(
    () => service.detail({ userId: "user", favoriteId: FAVORITE_ID }),
    (error: unknown) =>
      error instanceof ConversationFavoriteError
      && error.code === "CONVERSATION_FAVORITE_NOT_FOUND",
  );

  repository.deleteResult = false;
  await assert.rejects(
    () => service.delete({ userId: "user", favoriteId: FAVORITE_ID }),
    (error: unknown) =>
      error instanceof ConversationFavoriteError
      && error.code === "CONVERSATION_FAVORITE_NOT_FOUND",
  );
});
