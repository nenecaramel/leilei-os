import assert from "node:assert/strict";
import test from "node:test";
import {
  formatConversationBytes,
  formatConversationDateTime,
  groupConversationsByMonth,
  conversationProviderLabel,
} from "../web/src/pages/conversation-presentation.js";

type Item = { id: string; at: string | null };

test("Conversation month groups and rows are reverse chronological by the supplied date", () => {
  const groups = groupConversationsByMonth<Item>(
    [
      { id: "older-aug", at: "2026-08-10T08:00:00.000Z" },
      { id: "newer-sep", at: "2026-09-20T08:00:00.000Z" },
      { id: "older-sep", at: "2026-09-02T08:00:00.000Z" },
      { id: "newer-aug", at: "2026-08-30T08:00:00.000Z" },
    ],
    (item) => item.at,
  );

  assert.deepEqual(groups.map((group) => group.key), ["2026-09", "2026-08"]);
  assert.deepEqual(groups[0]?.items.map((item) => item.id), ["newer-sep", "older-sep"]);
  assert.deepEqual(groups[1]?.items.map((item) => item.id), ["newer-aug", "older-aug"]);
});

test("items without a valid date stay at the end", () => {
  const groups = groupConversationsByMonth<Item>(
    [
      { id: "unknown-a", at: null },
      { id: "dated", at: "2026-09-20T08:00:00.000Z" },
      { id: "unknown-b", at: "not-a-date" },
    ],
    (item) => item.at,
  );

  assert.deepEqual(groups.map((group) => group.key), ["2026-09", "unknown"]);
  assert.deepEqual(groups.at(-1)?.items.map((item) => item.id), ["unknown-a", "unknown-b"]);
});

test("Conversation presentation helpers preserve provider, missing-value, and invalid-date output", () => {
  assert.equal(conversationProviderLabel("chatgpt"), "ChatGPT");
  assert.equal(conversationProviderLabel("claude"), "Claude");
  assert.equal(formatConversationDateTime(null), "—");
  assert.equal(formatConversationDateTime("not-a-date"), "not-a-date");
});

test("Conversation byte presentation keeps the existing byte, KB, and MB thresholds", () => {
  assert.equal(formatConversationBytes(null), "—");
  assert.equal(formatConversationBytes(1), "1 KB");
  assert.equal(formatConversationBytes(1024), "1 KB");
  assert.equal(formatConversationBytes(1024 * 1024 - 1), "1024 KB");
  assert.equal(formatConversationBytes(1024 * 1024), "1.0 MB");
});
