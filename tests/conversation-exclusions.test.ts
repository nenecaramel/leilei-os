import assert from "node:assert/strict";
import test from "node:test";
import { ChatGPTExportParser } from "../src/domains/conversation/chatgpt-export-parser.js";
import { applyConversationExclusions } from "../src/domains/conversation/conversation-exclusions.js";
import { chatGptConversationFixture } from "./fixtures/chatgpt-conversation-export.js";

function conversation() {
  return ChatGPTExportParser.normalizeConversation(
    JSON.parse(JSON.stringify(chatGptConversationFixture)),
  ).conversation;
}

test("whole-conversation exclusions remove the canonical import candidate without mutating raw data", () => {
  const source = conversation();
  const result = applyConversationExclusions(source, [{
    provider: "chatgpt",
    scope: "conversation",
    sourceConversationId: source.sourceConversationId,
    sourceNodeId: null,
  }]);

  assert.equal(result.conversation, null);
  assert.equal(result.summary.conversations, 1);
  assert.equal(result.summary.messages, source.messages.length);
  assert.equal(source.messages.length > 0, true);
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/u);
});

test("branch exclusions remove the selected source node and every descendant only", () => {
  const source = conversation();
  const result = applyConversationExclusions(source, [{
    provider: "chatgpt",
    scope: "branch",
    sourceConversationId: source.sourceConversationId,
    sourceNodeId: "assistant-alt",
  }]);

  assert.ok(result.conversation);
  const remaining = new Set(result.conversation.messages.map((message) => message.sourceNodeId));
  assert.equal(remaining.has("assistant-alt"), false);
  assert.equal(remaining.has("user-media"), false);
  assert.equal(remaining.has("assistant-final"), true);
  assert.equal(result.summary.branch_roots, 1);
  assert.equal(result.summary.messages, 2);
  assert.equal(result.conversation.currentLeafSourceNodeId, "assistant-final");
});

test("excluding the current leaf moves canonical current leaf to the last retained current-path node", () => {
  const source = conversation();
  const result = applyConversationExclusions(source, [{
    provider: "chatgpt",
    scope: "branch",
    sourceConversationId: source.sourceConversationId,
    sourceNodeId: "assistant-final",
  }]);

  assert.ok(result.conversation);
  assert.equal(result.conversation.currentLeafSourceNodeId, "thoughts-1");
  assert.equal(
    result.conversation.messages.some((message) => message.sourceNodeId === "assistant-final"),
    false,
  );
});

test("unrelated or missing branch exclusions do not alter a conversation", () => {
  const source = conversation();
  const result = applyConversationExclusions(source, [
    {
      provider: "claude",
      scope: "conversation",
      sourceConversationId: source.sourceConversationId,
      sourceNodeId: null,
    },
    {
      provider: "chatgpt",
      scope: "branch",
      sourceConversationId: source.sourceConversationId,
      sourceNodeId: "no-longer-present",
    },
  ]);

  assert.equal(result.conversation?.messages.length, source.messages.length);
  assert.equal(result.summary.messages, 0);
  assert.equal(result.summary.branch_roots, 0);
});
