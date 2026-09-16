import assert from "node:assert/strict";
import test from "node:test";
import { ChatGPTExportParser } from "../src/domains/conversation/chatgpt-export-parser.js";
import { ConversationProviderParseError } from "../src/domains/conversation/provider-parser.js";
import { chatGptConversationFixture } from "./fixtures/chatgpt-conversation-export.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("ChatGPT adapter recognizes and normalizes provider-specific conversation objects", () => {
  assert.equal(ChatGPTExportParser.canParseConversation(chatGptConversationFixture), true);
  const { conversation, warnings } = ChatGPTExportParser.normalizeConversation(chatGptConversationFixture);
  assert.equal(conversation.provider, "chatgpt");
  assert.equal(conversation.sourceConversationId, "conv-real-shape");
  assert.equal(conversation.title, "Fixture derived from real ChatGPT export shapes");
  assert.equal(conversation.defaultModel, "gpt-5-6-thinking");
  assert.equal(conversation.currentLeafSourceNodeId, "assistant-final");
  assert.equal(conversation.providerMetadata.voice, "cove");
  assert.deepEqual(warnings, []);
});

test("ChatGPT adapter preserves branches while marking only the current_node ancestry as current", () => {
  const { conversation } = ChatGPTExportParser.normalizeConversation(chatGptConversationFixture);
  const byNode = new Map(conversation.messages.map((message) => [message.sourceNodeId, message]));
  assert.equal(byNode.get("user-1")?.isCurrentPath, true);
  assert.equal(byNode.get("reasoning-1")?.isCurrentPath, true);
  assert.equal(byNode.get("thoughts-1")?.isCurrentPath, true);
  assert.equal(byNode.get("assistant-final")?.isCurrentPath, true);
  assert.equal(byNode.get("assistant-alt")?.isCurrentPath, false);
  assert.equal(byNode.get("user-media")?.isCurrentPath, false);
  assert.deepEqual(
    conversation.messages.filter((message) => message.isCurrentPath).map((message) => message.currentPathIndex),
    [1, 2, 3, 4],
  );
});

test("ordinary message and turn semantics exclude reasoning/thought nodes", () => {
  const { conversation } = ChatGPTExportParser.normalizeConversation(chatGptConversationFixture);
  const byNode = new Map(conversation.messages.map((message) => [message.sourceNodeId, message]));
  assert.equal(byNode.get("user-1")?.isPrimary, true);
  assert.equal(byNode.get("user-1")?.turnIndex, 0);
  assert.equal(byNode.get("reasoning-1")?.isPrimary, false);
  assert.equal(byNode.get("reasoning-1")?.turnIndex, null);
  assert.equal(byNode.get("thoughts-1")?.isPrimary, false);
  assert.equal(byNode.get("thoughts-1")?.turnIndex, null);
  assert.equal(byNode.get("assistant-final")?.isPrimary, true);
  assert.equal(byNode.get("assistant-final")?.turnIndex, 0);
});

test("message-level model wins without guessing from the conversation default", () => {
  const { conversation } = ChatGPTExportParser.normalizeConversation(chatGptConversationFixture);
  const byNode = new Map(conversation.messages.map((message) => [message.sourceNodeId, message]));
  assert.equal(byNode.get("assistant-final")?.model, "gpt-5-5");
  assert.equal(byNode.get("user-1")?.model, null);
  assert.equal(conversation.defaultModel, "gpt-5-6-thinking");
});

test("real export content shapes normalize to typed blocks and attachment metadata", () => {
  const fixture = clone(chatGptConversationFixture) as any;
  fixture.current_node = "user-media";
  const { conversation } = ChatGPTExportParser.normalizeConversation(fixture);
  const media = conversation.messages.find((message) => message.sourceNodeId === "user-media");
  assert.ok(media);
  assert.equal(media.isCurrentPath, true);
  assert.equal(media.isPrimary, true);
  assert.deepEqual(media.contentBlocks.map((block) => block.kind), ["image", "audio", "text"]);
  assert.equal(media.displayText, "Hi ChatGPT\ncaption");
  assert.equal(media.attachments[0]?.sourceAttachmentId, "file-image");
  assert.equal(media.attachments[0]?.mimeType, "image/png");
  assert.equal(media.attachments[0]?.sizeBytes, 150060);
});

test("reasoning recap and thoughts are preserved without leaking into ordinary display text", () => {
  const { conversation } = ChatGPTExportParser.normalizeConversation(chatGptConversationFixture);
  const recap = conversation.messages.find((message) => message.sourceNodeId === "reasoning-1");
  const thoughts = conversation.messages.find((message) => message.sourceNodeId === "thoughts-1");
  assert.equal(recap?.contentBlocks[0]?.kind, "reasoning_recap");
  assert.equal(recap?.contentBlocks[0]?.text, "internal recap");
  assert.equal(recap?.displayText, "");
  assert.equal(thoughts?.contentBlocks[0]?.kind, "thinking");
  assert.equal(thoughts?.contentBlocks[0]?.text, "hidden thought");
  assert.equal(thoughts?.displayText, "");
});

test("unknown content types are preserved and warned instead of rejected", () => {
  const fixture = clone(chatGptConversationFixture) as any;
  fixture.mapping["assistant-final"].message.content = {
    content_type: "future_magic_block",
    content: "future payload",
    version: 7,
  } as never;
  const { conversation, warnings } = ChatGPTExportParser.normalizeConversation(fixture);
  const message = conversation.messages.find((item) => item.sourceNodeId === "assistant-final");
  assert.equal(message?.isPrimary, false);
  assert.equal(message?.contentBlocks[0]?.kind, "unknown");
  assert.equal(message?.contentBlocks[0]?.rawType, "future_magic_block");
  assert.equal(message?.contentBlocks[0]?.payload?.version, 7);
  assert.equal(warnings[0]?.code, "CHATGPT_UNKNOWN_CONTENT_TYPE");
});

test("invalid current-node graphs fail instead of inventing a visible path", () => {
  const missing = clone(chatGptConversationFixture) as any;
  missing.current_node = "missing";
  assert.throws(
    () => ChatGPTExportParser.normalizeConversation(missing),
    (error: unknown) => error instanceof ConversationProviderParseError,
  );

  const cycle = clone(chatGptConversationFixture) as any;
  cycle.mapping["user-1"].parent = "assistant-final";
  assert.throws(
    () => ChatGPTExportParser.normalizeConversation(cycle),
    (error: unknown) => error instanceof ConversationProviderParseError,
  );
});
