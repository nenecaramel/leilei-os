import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import {
  createConversationArchiveApi,
  type ConversationFavoriteDetail,
  type ConversationFavoriteListItem,
} from "../web/src/pages/conversation-archive-api.js";

const FAVORITE_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_A = "33333333-3333-4333-8333-333333333333";
const MESSAGE_B = "44444444-4444-4444-8444-444444444444";

function favorite(): ConversationFavoriteDetail {
  const base: ConversationFavoriteListItem = {
    id: FAVORITE_ID,
    provider: "chatgpt",
    sourceConversationId: "source-conversation",
    conversationId: CONVERSATION_ID,
    view: "default",
    title: "Important bit",
    note: "Remember this",
    tags: ["ai", "idea"],
    conversationTitleSnapshot: "Original title",
    startMessageId: MESSAGE_A,
    endMessageId: MESSAGE_B,
    startSourceNodeId: "node-a",
    endSourceNodeId: "node-b",
    messageCount: 2,
    canonicalConversationExists: true,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
  return {
    ...base,
    messages: [
      {
        ordinal: 0,
        messageId: MESSAGE_A,
        sourceNodeId: "node-a",
        sourceMessageId: "msg-a",
        role: "user",
        model: null,
        sourceCreatedAt: "2026-09-16T00:00:00.000Z",
        displayText: "first",
        snapshot: { version: 1 },
        canonicalMessageExists: true,
      },
      {
        ordinal: 1,
        messageId: MESSAGE_B,
        sourceNodeId: "node-b",
        sourceMessageId: "msg-b",
        role: "assistant",
        model: "gpt-5.6",
        sourceCreatedAt: "2026-09-16T00:01:00.000Z",
        displayText: "second",
        snapshot: { version: 1 },
        canonicalMessageExists: false,
      },
    ],
  };
}

test("Conversation Favorites Web adapter preserves create range and view semantics", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const value = favorite();
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      return { success: true, data: value } as T;
    },
  };
  const client = createConversationArchiveApi(api);

  await client.createFavorite({
    conversationId: CONVERSATION_ID,
    startMessageId: MESSAGE_A,
    endMessageId: MESSAGE_B,
    view: "all",
    title: "Range",
    note: "note",
    tags: ["one", "two"],
  });

  assert.equal(calls[0]?.path, "/conversations/favorites");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    conversation_id: CONVERSATION_ID,
    start_message_id: MESSAGE_A,
    end_message_id: MESSAGE_B,
    view: "all",
    title: "Range",
    note: "note",
    tags: ["one", "two"],
  });
});

test("Conversation Favorites Web adapter supports list detail partial metadata update and delete", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const value = favorite();
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      if (path === "/conversations/favorites?provider=chatgpt&tag=idea&limit=50&offset=0") {
        return { success: true, data: { items: [value], total: 1 } } as T;
      }
      if (init?.method === "DELETE") {
        return { success: true, data: { deleted: true } } as T;
      }
      return { success: true, data: value } as T;
    },
  };
  const client = createConversationArchiveApi(api);

  const list = await client.listFavorites({
    provider: "chatgpt",
    tag: "idea",
    limit: 50,
    offset: 0,
  });
  const detail = await client.favoriteDetail(FAVORITE_ID);
  await client.updateFavorite({
    favoriteId: FAVORITE_ID,
    note: "new note",
  });
  await client.deleteFavorite(FAVORITE_ID);

  assert.equal(list.total, 1);
  assert.equal(detail.messages.length, 2);
  assert.equal(calls[1]?.path, `/conversations/favorites/${FAVORITE_ID}`);
  assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)), { note: "new note" });
  assert.equal(calls[2]?.init?.method, "PATCH");
  assert.equal(calls[3]?.init?.method, "DELETE");
});

test("Conversation Favorites UI preserves snapshot reading and deletion semantics", () => {
  const panel = readFileSync(
    new URL("../web/src/pages/ConversationFavoritesPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(panel, /favoriteExcerpt/);
  assert.match(panel, /canonicalFavoriteLink/);
  assert.match(panel, /原窗口已删除/);
  assert.match(panel, /定位原文/);
  assert.match(panel, /client\.deleteFavorite/);
});
