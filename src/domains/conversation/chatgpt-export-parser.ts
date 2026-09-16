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

function unixSecondsToIso(value: unknown): string | null {
  const seconds = finiteNumberOrNull(value);
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cloneRecord(value: JsonRecord): JsonRecord {
  return structuredClone(value);
}

function normalizeRole(value: unknown): { role: ConversationRole; rawRole: string | null } {
  const rawRole = stringOrNull(value);
  if (rawRole === "user" || rawRole === "assistant" || rawRole === "system" || rawRole === "tool") {
    return { role: rawRole, rawRole };
  }
  if (rawRole === "reasoning" || rawRole === "analysis") {
    return { role: "reasoning", rawRole };
  }
  return { role: "unknown", rawRole };
}

function normalizedPart(
  value: unknown,
  ordinal: number,
  fallbackRawType: string,
): NormalizedConversationContentBlock {
  if (typeof value === "string") {
    return {
      ordinal,
      kind: "text",
      rawType: "text",
      text: value,
      payload: null,
    };
  }

  const object = record(value);
  if (!object) {
    return {
      ordinal,
      kind: "unknown",
      rawType: fallbackRawType,
      text: null,
      payload: { value },
    };
  }

  const rawType = stringOrNull(object.content_type) ?? fallbackRawType;
  const kind = blockKind(rawType);
  const text = typeof object.text === "string"
    ? object.text
    : typeof object.content === "string"
      ? object.content
      : null;
  return {
    ordinal,
    kind,
    rawType,
    text,
    payload: cloneRecord(object),
  };
}

function blockKind(rawType: string): ConversationContentKind {
  if (rawType === "text" || rawType === "audio_transcription") return rawType === "text" ? "text" : "audio";
  if (rawType === "thoughts" || rawType === "thinking") return "thinking";
  if (rawType === "reasoning_recap") return "reasoning_recap";
  if (rawType === "tool_use") return "tool_use";
  if (rawType === "tool_result") return "tool_result";
  if (rawType === "image_asset_pointer" || rawType === "image") return "image";
  if (rawType === "audio_asset_pointer" || rawType === "audio") return "audio";
  if (rawType === "real_time_user_audio_video_asset_pointer" || rawType === "video") return "video";
  if (rawType === "file" || rawType === "file_asset_pointer") return "file";
  return "unknown";
}

function normalizeContent(
  value: unknown,
  warnings: ConversationProviderWarning[],
  sourceConversationId: string,
  sourceNodeId: string,
): { blocks: NormalizedConversationContentBlock[]; rawType: string; displayText: string } {
  const content = record(value);
  if (!content) {
    warnings.push({
      code: "CHATGPT_MISSING_CONTENT",
      sourceConversationId,
      sourceNodeId,
      detail: "Message content is missing or is not an object.",
    });
    return { blocks: [], rawType: "unknown", displayText: "" };
  }

  const rawType = stringOrNull(content.content_type) ?? "unknown";
  let blocks: NormalizedConversationContentBlock[] = [];

  if (rawType === "text" || rawType === "multimodal_text") {
    const parts = Array.isArray(content.parts) ? content.parts : [];
    blocks = parts.map((part, index) => normalizedPart(part, index, rawType));
  } else if (rawType === "reasoning_recap") {
    blocks = [{
      ordinal: 0,
      kind: "reasoning_recap",
      rawType,
      text: stringOrNull(content.content),
      payload: cloneRecord(content),
    }];
  } else if (rawType === "thoughts") {
    const thoughts = Array.isArray(content.thoughts) ? content.thoughts : [];
    blocks = thoughts.map((thought, index) => {
      const object = record(thought);
      return {
        ordinal: index,
        kind: "thinking" as const,
        rawType,
        text: object
          ? stringOrNull(object.content) ?? stringOrNull(object.summary)
          : null,
        payload: object ? cloneRecord(object) : { value: thought },
      };
    });
    if (blocks.length === 0) {
      blocks = [{
        ordinal: 0,
        kind: "thinking",
        rawType,
        text: null,
        payload: cloneRecord(content),
      }];
    }
  } else {
    blocks = [normalizedPart(content, 0, rawType)];
    warnings.push({
      code: "CHATGPT_UNKNOWN_CONTENT_TYPE",
      sourceConversationId,
      sourceNodeId,
      detail: rawType,
    });
  }

  const displayText = blocks
    .filter((block) => block.kind === "text" || (block.kind === "audio" && block.rawType === "audio_transcription"))
    .map((block) => block.text ?? "")
    .filter((text) => text.length > 0)
    .join("\n");

  return { blocks, rawType, displayText };
}

function normalizeAttachments(value: unknown): NormalizedConversationAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const object = record(item) ?? {};
    return {
      ordinal: index,
      sourceAttachmentId: stringOrNull(object.id),
      name: stringOrNull(object.name),
      mimeType: stringOrNull(object.mime_type),
      sizeBytes: finiteNumberOrNull(object.size),
      payload: cloneRecord(object),
    };
  });
}

function currentPath(mapping: JsonRecord, currentNode: string | null): Map<string, number> {
  const reversed: string[] = [];
  const seen = new Set<string>();
  let cursor = currentNode;

  while (cursor) {
    if (seen.has(cursor)) {
      throw new ConversationProviderParseError("ChatGPT mapping contains a parent cycle.");
    }
    seen.add(cursor);
    const node = record(mapping[cursor]);
    if (!node) {
      throw new ConversationProviderParseError("ChatGPT current_node references a missing mapping node.");
    }
    reversed.push(cursor);
    cursor = stringOrNull(node.parent);
  }

  reversed.reverse();
  return new Map(reversed.map((nodeId, index) => [nodeId, index]));
}

function providerMetadata(conversation: JsonRecord): JsonRecord {
  const keys = [
    "conversation_template_id",
    "is_archived",
    "is_do_not_remember",
    "is_read_only",
    "is_starred",
    "is_study_mode",
    "memory_scope",
    "pinned_time",
    "plugin_ids",
    "voice",
  ] as const;
  const output: JsonRecord = {};
  for (const key of keys) {
    if (key in conversation) output[key] = structuredClone(conversation[key]);
  }
  return output;
}

function normalizeMessage(
  sourceConversationId: string,
  sourceNodeId: string,
  node: JsonRecord,
  currentPathIndex: number | null,
  turnIndex: number | null,
  warnings: ConversationProviderWarning[],
): { message: NormalizedConversationMessage | null; nextTurnIndex: number | null } {
  const rawMessage = record(node.message);
  if (!rawMessage) return { message: null, nextTurnIndex: turnIndex };

  const author = record(rawMessage.author);
  const roleInfo = normalizeRole(author?.role);
  const normalizedContent = normalizeContent(rawMessage.content, warnings, sourceConversationId, sourceNodeId);
  const rawType = normalizedContent.rawType;
  const isPrimary = (roleInfo.role === "user" || roleInfo.role === "assistant")
    && (rawType === "text" || rawType === "multimodal_text");

  let assignedTurn = turnIndex;
  let nextTurnIndex = turnIndex;
  if (currentPathIndex !== null && isPrimary && roleInfo.role === "user") {
    nextTurnIndex = (turnIndex ?? -1) + 1;
    assignedTurn = nextTurnIndex;
  } else if (currentPathIndex !== null && isPrimary && roleInfo.role === "assistant") {
    assignedTurn = turnIndex;
  } else if (currentPathIndex === null) {
    assignedTurn = null;
  }

  const metadata = record(rawMessage.metadata);
  return {
    message: {
      sourceNodeId,
      sourceMessageId: stringOrNull(rawMessage.id),
      parentSourceNodeId: stringOrNull(node.parent),
      role: roleInfo.role,
      rawRole: roleInfo.rawRole,
      model: stringOrNull(metadata?.model_slug),
      sourceCreatedAt: unixSecondsToIso(rawMessage.create_time),
      sourceUpdatedAt: unixSecondsToIso(rawMessage.update_time),
      isCurrentPath: currentPathIndex !== null,
      currentPathIndex,
      turnIndex: assignedTurn,
      isPrimary,
      displayText: isPrimary ? normalizedContent.displayText : "",
      contentBlocks: normalizedContent.blocks,
      attachments: normalizeAttachments(metadata?.attachments),
    },
    nextTurnIndex,
  };
}

export const ChatGPTExportParser: ConversationProviderParser = {
  provider: "chatgpt",

  canParseConversation(value: unknown): boolean {
    const conversation = record(value);
    return Boolean(
      conversation
      && typeof conversation.conversation_id === "string"
      && record(conversation.mapping),
    );
  },

  normalizeConversation(value: unknown): NormalizedConversationResult {
    const conversation = record(value);
    if (!conversation) throw new ConversationProviderParseError("ChatGPT conversation must be an object.");

    const sourceConversationId = stringOrNull(conversation.conversation_id) ?? stringOrNull(conversation.id);
    if (!sourceConversationId || sourceConversationId.trim().length === 0) {
      throw new ConversationProviderParseError("ChatGPT conversation_id is required.");
    }

    const mapping = record(conversation.mapping);
    if (!mapping) throw new ConversationProviderParseError("ChatGPT mapping is required.");

    const currentLeafSourceNodeId = stringOrNull(conversation.current_node);
    const path = currentPath(mapping, currentLeafSourceNodeId);
    const warnings: ConversationProviderWarning[] = [];

    const orderedNodeIds = Object.keys(mapping).sort((left, right) => {
      const leftPath = path.get(left);
      const rightPath = path.get(right);
      if (leftPath !== undefined && rightPath !== undefined) return leftPath - rightPath;
      if (leftPath !== undefined) return -1;
      if (rightPath !== undefined) return 1;
      return left.localeCompare(right);
    });

    const messages: NormalizedConversationMessage[] = [];
    let turnIndex: number | null = null;

    for (const sourceNodeId of orderedNodeIds) {
      const node = record(mapping[sourceNodeId]);
      if (!node) {
        warnings.push({
          code: "CHATGPT_INVALID_MAPPING_NODE",
          sourceConversationId,
          sourceNodeId,
          detail: "Mapping node is not an object.",
        });
        continue;
      }
      const normalized = normalizeMessage(
        sourceConversationId,
        sourceNodeId,
        node,
        path.get(sourceNodeId) ?? null,
        turnIndex,
        warnings,
      );
      if (normalized.message) messages.push(normalized.message);
      if (path.has(sourceNodeId)) turnIndex = normalized.nextTurnIndex;
    }

    return {
      conversation: {
        provider: "chatgpt",
        sourceConversationId,
        title: stringOrNull(conversation.title),
        sourceCreatedAt: unixSecondsToIso(conversation.create_time),
        sourceUpdatedAt: unixSecondsToIso(conversation.update_time),
        currentLeafSourceNodeId,
        defaultModel: stringOrNull(conversation.default_model_slug),
        providerMetadata: providerMetadata(conversation),
        messages,
      },
      warnings,
    };
  },
};
