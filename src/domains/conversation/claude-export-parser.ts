import type {
  ConversationContentKind,
  ConversationProviderWarning,
  ConversationRole,
  NormalizedConversationAttachment,
  NormalizedConversationContentBlock,
  NormalizedConversationMessage,
  NormalizedConversationResult,
} from "./conversation-types.js";
import {
  ConversationProviderParseError,
  type ConversationProviderParser,
} from "./provider-parser.js";

type JsonRecord = Record<string, unknown>;

const ZERO_UUID = "00000000-0000-4000-8000-000000000000";

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoTimestampOrNull(value: unknown): string | null {
  const text = stringOrNull(value);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(text).toISOString();
}

function cloneRecord(value: JsonRecord): JsonRecord {
  return structuredClone(value);
}

function role(value: unknown): { role: ConversationRole; rawRole: string | null } {
  const rawRole = stringOrNull(value);
  if (rawRole === "human") return { role: "user", rawRole };
  if (rawRole === "assistant") return { role: "assistant", rawRole };
  if (rawRole === "system") return { role: "system", rawRole };
  if (rawRole === "tool") return { role: "tool", rawRole };
  return { role: "unknown", rawRole };
}

function kind(rawType: string): ConversationContentKind {
  if (rawType === "text") return "text";
  if (rawType === "thinking") return "thinking";
  if (rawType === "tool_use") return "tool_use";
  if (rawType === "tool_result") return "tool_result";
  return "unknown";
}

function blockText(rawType: string, block: JsonRecord): string | null {
  if (rawType === "text") return stringOrNull(block.text);
  if (rawType === "thinking") {
    const direct = stringOrNull(block.thinking);
    if (direct) return direct;
    const summaries = Array.isArray(block.summaries) ? block.summaries : [];
    const summaryText = summaries
      .map((summary) => stringOrNull(record(summary)?.summary))
      .filter((value): value is string => Boolean(value))
      .join("\n");
    return summaryText || null;
  }
  return null;
}

function normalizeBlocks(
  value: unknown,
  sourceConversationId: string,
  sourceNodeId: string,
  warnings: ConversationProviderWarning[],
): NormalizedConversationContentBlock[] {
  if (!Array.isArray(value)) {
    warnings.push({
      code: "CLAUDE_INVALID_CONTENT",
      sourceConversationId,
      sourceNodeId,
      detail: "content is not an array",
    });
    return [];
  }

  return value.map((item, ordinal): NormalizedConversationContentBlock => {
    const block = record(item);
    if (!block) {
      warnings.push({
        code: "CLAUDE_INVALID_CONTENT_BLOCK",
        sourceConversationId,
        sourceNodeId,
        detail: `content[${ordinal}] is not an object`,
      });
      return {
        ordinal,
        kind: "unknown",
        rawType: "unknown",
        text: null,
        payload: { value: item },
      };
    }

    const rawType = stringOrNull(block.type) ?? "unknown";
    const normalizedKind = kind(rawType);
    if (normalizedKind === "unknown") {
      warnings.push({
        code: "CLAUDE_UNKNOWN_CONTENT_TYPE",
        sourceConversationId,
        sourceNodeId,
        detail: rawType,
      });
    }

    return {
      ordinal,
      kind: normalizedKind,
      rawType,
      text: blockText(rawType, block),
      payload: cloneRecord(block),
    };
  });
}

function normalizeAttachments(message: JsonRecord): NormalizedConversationAttachment[] {
  const output: NormalizedConversationAttachment[] = [];

  const files = Array.isArray(message.files) ? message.files : [];
  for (const file of files) {
    const object = record(file) ?? {};
    output.push({
      ordinal: output.length,
      sourceAttachmentId: stringOrNull(object.file_uuid),
      name: stringOrNull(object.file_name),
      mimeType: null,
      sizeBytes: null,
      payload: cloneRecord(object),
    });
  }

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  for (const attachment of attachments) {
    const object = record(attachment) ?? {};
    output.push({
      ordinal: output.length,
      sourceAttachmentId: stringOrNull(object.uuid) ?? stringOrNull(object.file_uuid),
      name: stringOrNull(object.file_name),
      mimeType: stringOrNull(object.file_type),
      sizeBytes: finiteNumberOrNull(object.file_size),
      payload: cloneRecord(object),
    });
  }

  return output;
}

function displayText(blocks: NormalizedConversationContentBlock[]): string {
  return blocks
    .filter((block) => block.kind === "text")
    .map((block) => block.text ?? "")
    .filter((text) => text.length > 0)
    .join("\n");
}

function providerMetadata(conversation: JsonRecord): JsonRecord {
  const output: JsonRecord = {};
  if ("summary" in conversation) output.summary = structuredClone(conversation.summary);
  if ("account" in conversation) output.account = structuredClone(conversation.account);
  output.current_path_source = "unavailable_in_export";
  return output;
}

export const ClaudeExportParser: ConversationProviderParser = {
  provider: "claude",

  canParseConversation(value: unknown): boolean {
    const conversation = record(value);
    return Boolean(
      conversation
      && typeof conversation.uuid === "string"
      && Array.isArray(conversation.chat_messages),
    );
  },

  normalizeConversation(value: unknown): NormalizedConversationResult {
    const conversation = record(value);
    if (!conversation) {
      throw new ConversationProviderParseError("Claude conversation must be an object.");
    }

    const sourceConversationId = stringOrNull(conversation.uuid);
    if (!sourceConversationId || sourceConversationId.trim().length === 0) {
      throw new ConversationProviderParseError("Claude uuid is required.");
    }
    if (!Array.isArray(conversation.chat_messages)) {
      throw new ConversationProviderParseError("Claude chat_messages must be an array.");
    }

    const warnings: ConversationProviderWarning[] = [];
    const seenNodes = new Set<string>();
    const messages: NormalizedConversationMessage[] = [];

    for (const raw of conversation.chat_messages) {
      const message = record(raw);
      if (!message) {
        warnings.push({
          code: "CLAUDE_INVALID_MESSAGE",
          sourceConversationId,
          sourceNodeId: null,
          detail: "chat_messages item is not an object",
        });
        continue;
      }

      const sourceNodeId = stringOrNull(message.uuid);
      if (!sourceNodeId || sourceNodeId.trim().length === 0) {
        warnings.push({
          code: "CLAUDE_MISSING_MESSAGE_UUID",
          sourceConversationId,
          sourceNodeId: null,
          detail: "message uuid is missing",
        });
        continue;
      }
      if (seenNodes.has(sourceNodeId)) {
        throw new ConversationProviderParseError("Claude chat_messages contains duplicate message UUIDs.");
      }
      seenNodes.add(sourceNodeId);

      const normalizedRole = role(message.sender);
      const contentBlocks = normalizeBlocks(
        message.content,
        sourceConversationId,
        sourceNodeId,
        warnings,
      );
      const attachments = normalizeAttachments(message);
      const visibleText = displayText(contentBlocks);
      const isPrimary = normalizedRole.role === "user"
        ? visibleText.length > 0 || attachments.length > 0
        : normalizedRole.role === "assistant" && visibleText.length > 0;
      const rawParent = stringOrNull(message.parent_message_uuid);
      const parentSourceNodeId = rawParent && rawParent !== ZERO_UUID ? rawParent : null;

      messages.push({
        sourceNodeId,
        sourceMessageId: sourceNodeId,
        parentSourceNodeId,
        role: normalizedRole.role,
        rawRole: normalizedRole.rawRole,
        model: null,
        sourceCreatedAt: isoTimestampOrNull(message.created_at),
        sourceUpdatedAt: isoTimestampOrNull(message.updated_at),
        isCurrentPath: false,
        currentPathIndex: null,
        turnIndex: null,
        isPrimary,
        displayText: isPrimary ? visibleText : "",
        contentBlocks,
        attachments,
      });
    }

    return {
      conversation: {
        provider: "claude",
        sourceConversationId,
        title: stringOrNull(conversation.name),
        sourceCreatedAt: isoTimestampOrNull(conversation.created_at),
        sourceUpdatedAt: isoTimestampOrNull(conversation.updated_at),
        currentLeafSourceNodeId: null,
        defaultModel: null,
        providerMetadata: providerMetadata(conversation),
        messages,
      },
      warnings,
    };
  },
};
