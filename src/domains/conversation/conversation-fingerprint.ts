import { hashCanonical } from "../import/import-canonical.js";
import type {
  NormalizedConversation,
  NormalizedConversationMessage,
} from "./conversation-types.js";

export function conversationSourceFingerprint(
  conversation: NormalizedConversation,
): string {
  return hashCanonical({
    provider: conversation.provider,
    sourceConversationId: conversation.sourceConversationId,
    title: conversation.title,
    sourceCreatedAt: conversation.sourceCreatedAt,
    sourceUpdatedAt: conversation.sourceUpdatedAt,
    currentLeafSourceNodeId: conversation.currentLeafSourceNodeId,
    defaultModel: conversation.defaultModel,
    providerMetadata: conversation.providerMetadata,
  });
}

export function conversationMessageSourceFingerprint(
  message: NormalizedConversationMessage,
): string {
  return hashCanonical({
    sourceNodeId: message.sourceNodeId,
    sourceMessageId: message.sourceMessageId,
    parentSourceNodeId: message.parentSourceNodeId,
    role: message.role,
    rawRole: message.rawRole,
    model: message.model,
    sourceCreatedAt: message.sourceCreatedAt,
    sourceUpdatedAt: message.sourceUpdatedAt,
    isPrimary: message.isPrimary,
    displayText: message.displayText,
    contentBlocks: message.contentBlocks,
    attachments: message.attachments,
  });
}

export function conversationMessagePathFingerprint(
  message: Pick<
    NormalizedConversationMessage,
    "isCurrentPath" | "currentPathIndex" | "turnIndex"
  >,
): string {
  return hashCanonical({
    isCurrentPath: message.isCurrentPath,
    currentPathIndex: message.currentPathIndex,
    turnIndex: message.turnIndex,
  });
}

export function conversationMessageVersionSnapshot(
  message: NormalizedConversationMessage,
): Record<string, unknown> {
  return structuredClone(message) as unknown as Record<string, unknown>;
}
