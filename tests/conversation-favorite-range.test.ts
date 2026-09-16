import assert from "node:assert/strict";
import test from "node:test";
import {
  ConversationFavoriteRangeError,
  selectConversationFavoriteRange,
} from "../src/domains/conversation/conversation-favorite-range.js";

const messages = Array.from({ length: 6 }, (_, index) => ({
  id: `message-${index}`,
  value: index,
}));

test("Conversation favorite range is inclusive and canonical-order preserving", () => {
  const selected = selectConversationFavoriteRange(
    messages,
    "message-1",
    "message-3",
  );
  assert.deepEqual(selected.map((message) => message.value), [1, 2, 3]);
});

test("Conversation favorite range accepts reversed endpoints but stores canonical order", () => {
  const selected = selectConversationFavoriteRange(
    messages,
    "message-4",
    "message-2",
  );
  assert.deepEqual(selected.map((message) => message.value), [2, 3, 4]);
});

test("Conversation favorite range rejects missing endpoints and oversized captures", () => {
  assert.throws(
    () => selectConversationFavoriteRange(messages, "missing", "message-1"),
    (error: unknown) =>
      error instanceof ConversationFavoriteRangeError
      && error.code === "CONVERSATION_FAVORITE_RANGE_NOT_FOUND",
  );

  assert.throws(
    () => selectConversationFavoriteRange(messages, "message-0", "message-5", 5),
    (error: unknown) =>
      error instanceof ConversationFavoriteRangeError
      && error.code === "CONVERSATION_FAVORITE_RANGE_TOO_LARGE",
  );
});
