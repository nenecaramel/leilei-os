import assert from "node:assert/strict";
import test from "node:test";
import { ClaudeExportParser } from "../src/domains/conversation/claude-export-parser.js";
import { ConversationProviderParseError } from "../src/domains/conversation/provider-parser.js";
import { claudeConversationFixture } from "./fixtures/claude-conversation-export.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("Claude adapter recognizes the real export family and keeps model unknown", () => {
  assert.equal(ClaudeExportParser.canParseConversation(claudeConversationFixture), true);
  const { conversation } = ClaudeExportParser.normalizeConversation(claudeConversationFixture);
  assert.equal(conversation.provider, "claude");
  assert.equal(conversation.sourceConversationId, "claude-conversation-fixture");
  assert.equal(conversation.title, "Claude fixture");
  assert.equal(conversation.defaultModel, null);
  assert.equal(conversation.currentLeafSourceNodeId, null);
  assert.equal(conversation.providerMetadata.current_path_source, "unavailable_in_export");
});

test("Claude parent_message_uuid becomes the canonical graph without inventing a current branch", () => {
  const { conversation } = ClaudeExportParser.normalizeConversation(claudeConversationFixture);
  const byNode = new Map(conversation.messages.map((message) => [message.sourceNodeId, message]));
  assert.equal(byNode.get("human-root")?.parentSourceNodeId, null);
  assert.equal(byNode.get("assistant-main")?.parentSourceNodeId, "human-root");
  assert.equal(byNode.get("human-file-branch")?.parentSourceNodeId, "assistant-main");
  assert.equal(byNode.get("human-alt-branch")?.parentSourceNodeId, "assistant-main");
  for (const message of conversation.messages) {
    assert.equal(message.isCurrentPath, false);
    assert.equal(message.currentPathIndex, null);
    assert.equal(message.turnIndex, null);
  }
});

test("Claude typed content blocks preserve thinking and tool payloads while display text stays visible-only", () => {
  const { conversation } = ClaudeExportParser.normalizeConversation(claudeConversationFixture);
  const assistant = conversation.messages.find((message) => message.sourceNodeId === "assistant-main");
  assert.ok(assistant);
  assert.deepEqual(assistant.contentBlocks.map((block) => block.kind), [
    "thinking",
    "tool_use",
    "tool_result",
    "text",
  ]);
  assert.equal(assistant.contentBlocks[0]?.text, "thinking summary");
  assert.equal(assistant.displayText, "answer");
  assert.equal(assistant.isPrimary, true);
  assert.equal(assistant.model, null);
});

test("Claude files and attachment metadata normalize without requiring original bytes", () => {
  const { conversation } = ClaudeExportParser.normalizeConversation(claudeConversationFixture);
  const message = conversation.messages.find((item) => item.sourceNodeId === "human-file-branch");
  assert.ok(message);
  assert.equal(message.isPrimary, true);
  assert.equal(message.attachments.length, 2);
  assert.equal(message.attachments[0]?.sourceAttachmentId, "file-fixture");
  assert.equal(message.attachments[0]?.name, "image.png");
  assert.equal(message.attachments[1]?.name, "notes.md");
  assert.equal(message.attachments[1]?.mimeType, "text/markdown");
  assert.equal(message.attachments[1]?.sizeBytes, 42);
  assert.equal(message.attachments[1]?.payload.extracted_content, "# Notes");
});

test("Claude internal/unknown blocks are preserved and warned, not flattened into visible text", () => {
  const { conversation, warnings } = ClaudeExportParser.normalizeConversation(claudeConversationFixture);
  const message = conversation.messages.find((item) => item.sourceNodeId === "assistant-internal");
  assert.ok(message);
  assert.equal(message.isPrimary, false);
  assert.equal(message.displayText, "");
  assert.equal(message.contentBlocks[0]?.kind, "unknown");
  assert.equal(message.contentBlocks[0]?.rawType, "injected_prompt_block");
  assert.equal(message.contentBlocks[0]?.payload?.injection_source, "memory");
  assert.ok(warnings.some((warning) =>
    warning.code === "CLAUDE_UNKNOWN_CONTENT_TYPE"
    && warning.detail === "injected_prompt_block"
  ));
});

test("Claude parser rejects duplicate message UUIDs instead of collapsing branches", () => {
  const duplicate = clone(claudeConversationFixture) as any;
  duplicate.chat_messages.push({ ...duplicate.chat_messages[0] });
  assert.throws(
    () => ClaudeExportParser.normalizeConversation(duplicate),
    (error: unknown) => error instanceof ConversationProviderParseError,
  );
});
