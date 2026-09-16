import { hashCanonical } from "../import/import-canonical.js";
import type {
  ConversationProvider,
  NormalizedConversation,
  NormalizedConversationMessage,
} from "./conversation-types.js";
import {
  conversationMessagePathFingerprint,
  conversationMessageSourceFingerprint,
  conversationSourceFingerprint,
} from "./conversation-fingerprint.js";

export type ConversationMergeClassification = "create" | "update" | "unchanged";

export type CurrentConversationMessageState = {
  id: string;
  sourceNodeId: string;
  sourceFingerprint: string;
  isCurrentPath: boolean;
  currentPathIndex: number | null;
  turnIndex: number | null;
};

export type CurrentConversationState = {
  id: string;
  provider: ConversationProvider;
  sourceConversationId: string;
  sourceFingerprint: string;
  messages: CurrentConversationMessageState[];
};

export type ConversationMergeCurrentState = {
  conversations: CurrentConversationState[];
};

export type ConversationMergeMessageItem = {
  sourceNodeId: string;
  classification: ConversationMergeClassification;
  currentId: string | null;
  currentFingerprint: string | null;
  currentPathFingerprint: string | null;
  importedFingerprint: string;
  pathChanged: boolean;
  message: NormalizedConversationMessage;
};

export type ConversationMergeConversationItem = {
  provider: ConversationProvider;
  sourceConversationId: string;
  classification: ConversationMergeClassification;
  currentId: string | null;
  currentFingerprint: string | null;
  importedFingerprint: string;
  conversation: NormalizedConversation;
  messages: ConversationMergeMessageItem[];
};

export type ConversationMergeSummary = {
  conversations: Record<ConversationMergeClassification, number>;
  messages: Record<ConversationMergeClassification, number> & {
    path_changed: number;
  };
};

export type ConversationMergePlan = {
  sourceSha256: string;
  parserVersion: string;
  previewFingerprint: string;
  hasCanonicalChanges: boolean;
  summary: ConversationMergeSummary;
  items: ConversationMergeConversationItem[];
};

export class ConversationMergePlanError extends Error {
  constructor(
    public readonly code:
      | "INVALID_SOURCE_SHA256"
      | "INVALID_PARSER_VERSION"
      | "DUPLICATE_CONVERSATION"
      | "DUPLICATE_MESSAGE_NODE",
  ) {
    super(code);
    this.name = "ConversationMergePlanError";
  }
}

function emptyCounts(): Record<ConversationMergeClassification, number> {
  return { create: 0, update: 0, unchanged: 0 };
}

function classification(
  currentFingerprint: string | null,
  importedFingerprint: string,
): ConversationMergeClassification {
  if (currentFingerprint === null) return "create";
  return currentFingerprint === importedFingerprint ? "unchanged" : "update";
}

function conversationKey(
  provider: ConversationProvider,
  sourceConversationId: string,
): string {
  return `${provider}\u0000${sourceConversationId}`;
}

function assertUniqueImportedConversations(
  imported: readonly NormalizedConversation[],
): void {
  const seen = new Set<string>();
  for (const conversation of imported) {
    const key = conversationKey(conversation.provider, conversation.sourceConversationId);
    if (seen.has(key)) throw new ConversationMergePlanError("DUPLICATE_CONVERSATION");
    seen.add(key);

    const nodes = new Set<string>();
    for (const message of conversation.messages) {
      if (nodes.has(message.sourceNodeId)) {
        throw new ConversationMergePlanError("DUPLICATE_MESSAGE_NODE");
      }
      nodes.add(message.sourceNodeId);
    }
  }
}

export function buildConversationMergePlan(
  imported: readonly NormalizedConversation[],
  current: ConversationMergeCurrentState,
  sourceSha256: string,
  parserVersion: string,
): ConversationMergePlan {
  if (!/^[0-9a-f]{64}$/u.test(sourceSha256)) {
    throw new ConversationMergePlanError("INVALID_SOURCE_SHA256");
  }
  if (!parserVersion.trim() || parserVersion.length > 64) {
    throw new ConversationMergePlanError("INVALID_PARSER_VERSION");
  }
  assertUniqueImportedConversations(imported);

  const currentByKey = new Map(
    current.conversations.map((conversation) => [
      conversationKey(conversation.provider, conversation.sourceConversationId),
      conversation,
    ]),
  );

  const summary: ConversationMergeSummary = {
    conversations: emptyCounts(),
    messages: { ...emptyCounts(), path_changed: 0 },
  };

  const items = imported.map((conversation): ConversationMergeConversationItem => {
    const key = conversationKey(conversation.provider, conversation.sourceConversationId);
    const existing = currentByKey.get(key) ?? null;
    const importedFingerprint = conversationSourceFingerprint(conversation);
    const conversationClassification = classification(
      existing?.sourceFingerprint ?? null,
      importedFingerprint,
    );
    summary.conversations[conversationClassification] += 1;

    const currentMessages = new Map(
      (existing?.messages ?? []).map((message) => [message.sourceNodeId, message]),
    );
    const messages = conversation.messages.map((message): ConversationMergeMessageItem => {
      const currentMessage = currentMessages.get(message.sourceNodeId) ?? null;
      const messageFingerprint = conversationMessageSourceFingerprint(message);
      const messageClassification = classification(
        currentMessage?.sourceFingerprint ?? null,
        messageFingerprint,
      );
      const currentPathFingerprint = currentMessage === null
        ? null
        : conversationMessagePathFingerprint(currentMessage);
      const pathChanged = currentPathFingerprint !== null
        && currentPathFingerprint !== conversationMessagePathFingerprint(message);
      summary.messages[messageClassification] += 1;
      if (pathChanged) summary.messages.path_changed += 1;
      return {
        sourceNodeId: message.sourceNodeId,
        classification: messageClassification,
        currentId: currentMessage?.id ?? null,
        currentFingerprint: currentMessage?.sourceFingerprint ?? null,
        currentPathFingerprint,
        importedFingerprint: messageFingerprint,
        pathChanged,
        message,
      };
    });

    return {
      provider: conversation.provider,
      sourceConversationId: conversation.sourceConversationId,
      classification: conversationClassification,
      currentId: existing?.id ?? null,
      currentFingerprint: existing?.sourceFingerprint ?? null,
      importedFingerprint,
      conversation,
      messages,
    };
  });

  const hasCanonicalChanges =
    summary.conversations.create > 0
    || summary.conversations.update > 0
    || summary.messages.create > 0
    || summary.messages.update > 0
    || summary.messages.path_changed > 0;

  const previewFingerprint = hashCanonical({
    sourceSha256,
    parserVersion,
    current: items.map((item) => ({
      provider: item.provider,
      sourceConversationId: item.sourceConversationId,
      currentFingerprint: item.currentFingerprint,
      messages: item.messages.map((message) => ({
        sourceNodeId: message.sourceNodeId,
        currentFingerprint: message.currentFingerprint,
        currentPathFingerprint: message.currentPathFingerprint,
      })),
    })),
  });

  return {
    sourceSha256,
    parserVersion,
    previewFingerprint,
    hasCanonicalChanges,
    summary,
    items,
  };
}
