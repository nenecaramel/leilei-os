import assert from "node:assert/strict";
import test from "node:test";
import { ChatGPTExportParser } from "../src/domains/conversation/chatgpt-export-parser.js";
import {
  buildConversationMergePlan,
  ConversationMergePlanError,
  type ConversationMergeCurrentState,
} from "../src/domains/conversation/conversation-merge-planner.js";
import {
  conversationMessageSourceFingerprint,
  conversationSourceFingerprint,
} from "../src/domains/conversation/conversation-fingerprint.js";
import { chatGptConversationFixture } from "./fixtures/chatgpt-conversation-export.js";

const SHA = "a".repeat(64);
const VERSION = "chatgpt-v1";

function imported() {
  return ChatGPTExportParser.normalizeConversation(
    JSON.parse(JSON.stringify(chatGptConversationFixture)),
  ).conversation;
}

function asCurrent(conversation = imported()): ConversationMergeCurrentState {
  return {
    conversations: [{
      id: "conversation-db-id",
      provider: conversation.provider,
      sourceConversationId: conversation.sourceConversationId,
      sourceFingerprint: conversationSourceFingerprint(conversation),
      sourceCreatedAt: conversation.sourceCreatedAt,
      sourceUpdatedAt: conversation.sourceUpdatedAt,
      messages: conversation.messages.map((message, index) => ({
        id: `message-db-${index}`,
        sourceNodeId: message.sourceNodeId,
        sourceFingerprint: conversationMessageSourceFingerprint(message),
        sourceCreatedAt: message.sourceCreatedAt,
        sourceUpdatedAt: message.sourceUpdatedAt,
        isCurrentPath: message.isCurrentPath,
        currentPathIndex: message.currentPathIndex,
        turnIndex: message.turnIndex,
      })),
    }],
  };
}

test("first import plans creates for conversation and every message", () => {
  const conversation = imported();
  const plan = buildConversationMergePlan(
    [conversation],
    { conversations: [] },
    SHA,
    VERSION,
  );
  assert.deepEqual(plan.summary.conversations, { create: 1, update: 0, unchanged: 0, stale: 0 });
  assert.equal(plan.summary.messages.create, conversation.messages.length);
  assert.equal(plan.summary.messages.update, 0);
  assert.equal(plan.summary.messages.unchanged, 0);
  assert.equal(plan.summary.messages.path_changed, 0);
  assert.equal(plan.hasCanonicalChanges, true);
  assert.match(plan.previewFingerprint, /^[0-9a-f]{64}$/u);
});

test("repeating the same normalized export is fully unchanged", () => {
  const conversation = imported();
  const plan = buildConversationMergePlan([conversation], asCurrent(conversation), SHA, VERSION);
  assert.deepEqual(plan.summary.conversations, { create: 0, update: 0, unchanged: 1, stale: 0 });
  assert.equal(plan.summary.messages.create, 0);
  assert.equal(plan.summary.messages.update, 0);
  assert.equal(plan.summary.messages.unchanged, conversation.messages.length);
  assert.equal(plan.summary.messages.path_changed, 0);
  assert.equal(plan.hasCanonicalChanges, false);
});

test("message content changes are updates and do not masquerade as path changes", () => {
  const before = imported();
  const after = imported();
  const target = after.messages.find((message) => message.sourceNodeId === "assistant-final");
  assert.ok(target);
  target.displayText = "edited answer";
  target.contentBlocks = target.contentBlocks.map((block) =>
    block.ordinal === 0 ? { ...block, text: "edited answer" } : block
  );
  const plan = buildConversationMergePlan([after], asCurrent(before), SHA, VERSION);
  const item = plan.items[0]?.messages.find((message) => message.sourceNodeId === "assistant-final");
  assert.equal(item?.classification, "update");
  assert.equal(item?.pathChanged, false);
  assert.equal(plan.summary.messages.update, 1);
});

test("switching current leaf changes path state without changing message source fingerprints", () => {
  const before = imported();
  const raw = JSON.parse(JSON.stringify(chatGptConversationFixture));
  raw.current_node = "user-media";
  const after = ChatGPTExportParser.normalizeConversation(raw).conversation;
  const plan = buildConversationMergePlan([after], asCurrent(before), SHA, VERSION);
  assert.equal(plan.summary.messages.update, 0);
  assert.ok(plan.summary.messages.path_changed > 0);
  assert.equal(plan.summary.conversations.update, 1);
  assert.equal(plan.hasCanonicalChanges, true);
});

test("new messages are added while stored messages absent from the new export are not represented as deletes", () => {
  const before = imported();
  const after = imported();
  after.messages = after.messages.filter((message) => message.sourceNodeId !== "assistant-alt");
  after.messages.push({
    ...after.messages.find((message) => message.sourceNodeId === "assistant-final")!,
    sourceNodeId: "new-node",
    sourceMessageId: "new-message",
    parentSourceNodeId: "assistant-final",
    sourceCreatedAt: "2026-09-16T05:00:00.000Z",
    isCurrentPath: false,
    currentPathIndex: null,
    turnIndex: null,
    displayText: "new branch",
    contentBlocks: [{ ordinal: 0, kind: "text", rawType: "text", text: "new branch", payload: null }],
  });
  const plan = buildConversationMergePlan([after], asCurrent(before), SHA, VERSION);
  assert.equal(plan.summary.messages.create, 1);
  assert.equal(plan.items[0]?.messages.some((message) => message.sourceNodeId === "assistant-alt"), false);
});

test("planner rejects duplicate source identities and invalid binding inputs", () => {
  const conversation = imported();
  assert.throws(
    () => buildConversationMergePlan([conversation, conversation], { conversations: [] }, SHA, VERSION),
    (error: unknown) => error instanceof ConversationMergePlanError && error.code === "DUPLICATE_CONVERSATION",
  );
  const duplicateNode = imported();
  duplicateNode.messages.push({ ...duplicateNode.messages[0]! });
  assert.throws(
    () => buildConversationMergePlan([duplicateNode], { conversations: [] }, SHA, VERSION),
    (error: unknown) => error instanceof ConversationMergePlanError && error.code === "DUPLICATE_MESSAGE_NODE",
  );
  assert.throws(
    () => buildConversationMergePlan([conversation], { conversations: [] }, "bad", VERSION),
    (error: unknown) => error instanceof ConversationMergePlanError && error.code === "INVALID_SOURCE_SHA256",
  );
});


test("older provider snapshots are classified stale instead of reverting newer canonical data", () => {
  const before = imported();
  const current = asCurrent(before);
  const stored = current.conversations[0]!;
  stored.sourceUpdatedAt = "2026-09-17T00:00:00.000Z";
  const storedMessage = stored.messages.find((message) => message.sourceNodeId === "assistant-final")!;
  storedMessage.sourceUpdatedAt = "2026-09-17T00:00:00.000Z";

  const older = imported();
  older.title = "older title that differs";
  older.sourceUpdatedAt = "2026-09-16T00:00:00.000Z";
  const message = older.messages.find((item) => item.sourceNodeId === "assistant-final")!;
  message.displayText = "older edited answer";
  message.contentBlocks = message.contentBlocks.map((block) =>
    block.ordinal === 0 ? { ...block, text: "older edited answer" } : block
  );
  message.sourceUpdatedAt = "2026-09-16T00:00:00.000Z";

  const plan = buildConversationMergePlan([older], current, SHA, VERSION);
  assert.equal(plan.summary.conversations.stale, 1);
  assert.equal(
    plan.items[0]?.messages.find((item) => item.sourceNodeId === "assistant-final")?.classification,
    "stale",
  );
  assert.equal(plan.summary.messages.stale, 1);
});


test("a stale conversation snapshot cannot update existing messages even when message timestamps are ambiguous", () => {
  const before = imported();
  const current = asCurrent(before);
  const stored = current.conversations[0]!;
  stored.sourceUpdatedAt = "2026-09-17T00:00:00.000Z";

  const older = imported();
  older.sourceUpdatedAt = "2026-09-16T00:00:00.000Z";
  const target = older.messages.find((message) => message.sourceNodeId === "assistant-final")!;
  target.displayText = "older body with the same message timestamp";
  target.contentBlocks = target.contentBlocks.map((block) =>
    block.ordinal === 0
      ? { ...block, text: "older body with the same message timestamp" }
      : block
  );

  const plan = buildConversationMergePlan([older], current, SHA, VERSION);
  const item = plan.items[0]?.messages.find(
    (message) => message.sourceNodeId === "assistant-final",
  );
  assert.equal(plan.summary.conversations.stale, 1);
  assert.equal(item?.classification, "stale");
});
