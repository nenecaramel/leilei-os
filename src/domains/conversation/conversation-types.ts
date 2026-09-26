export type ConversationProvider = "chatgpt" | "claude";
export type ConversationOrigin = "legacy_import" | "native_live";
export type ConversationLifecycleStatus = "active" | "archived" | "deleted";
export type ConversationMessageStatus = "pending" | "streaming" | "completed" | "error";
export type ConversationRuntimeProvider = "claude_code";

export type ConversationRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "reasoning"
  | "unknown";

export type ConversationContentKind =
  | "text"
  | "thinking"
  | "reasoning_recap"
  | "tool_use"
  | "tool_result"
  | "image"
  | "audio"
  | "video"
  | "file"
  | "attachment"
  | "unknown";

export type NormalizedConversationContentBlock = {
  ordinal: number;
  kind: ConversationContentKind;
  rawType: string;
  text: string | null;
  payload: Record<string, unknown> | null;
};

export type NormalizedConversationAttachment = {
  ordinal: number;
  sourceAttachmentId: string | null;
  name: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  payload: Record<string, unknown>;
};

export type NormalizedConversationMessage = {
  sourceNodeId: string;
  sourceMessageId: string | null;
  parentSourceNodeId: string | null;
  role: ConversationRole;
  rawRole: string | null;
  model: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  isCurrentPath: boolean;
  currentPathIndex: number | null;
  turnIndex: number | null;
  isPrimary: boolean;
  displayText: string;
  contentBlocks: NormalizedConversationContentBlock[];
  attachments: NormalizedConversationAttachment[];
};

export type NormalizedConversation = {
  provider: ConversationProvider;
  sourceConversationId: string;
  title: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  currentLeafSourceNodeId: string | null;
  defaultModel: string | null;
  providerMetadata: Record<string, unknown>;
  messages: NormalizedConversationMessage[];
};

export type ConversationProviderWarning = {
  code: string;
  sourceConversationId: string | null;
  sourceNodeId: string | null;
  detail: string;
};

export type NormalizedConversationResult = {
  conversation: NormalizedConversation;
  warnings: ConversationProviderWarning[];
};
