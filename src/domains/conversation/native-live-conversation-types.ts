import type {
  ConversationLifecycleStatus,
  ConversationMessageStatus,
  ConversationRuntimeProvider,
} from "../../database/schema.js";

export type NativeLiveContentKind =
  | "text"
  | "tool_use"
  | "tool_result"
  | "attachment";

export type NativeLiveContentBlockInput = {
  kind: NativeLiveContentKind;
  rawType?: string;
  text?: string | null;
  payload?: Record<string, unknown> | null;
};

export type NativeLiveContentBlock = {
  id: string;
  ordinal: number;
  kind: NativeLiveContentKind;
  rawType: string;
  text: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type NativeLiveMessage = {
  id: string;
  conversationId: string;
  parentMessageId: string | null;
  role: "user" | "assistant";
  status: ConversationMessageStatus;
  createdAt: string;
  completedAt: string | null;
  blocks: NativeLiveContentBlock[];
};

export type NativeLiveConversationSummary = {
  id: string;
  title: string | null;
  currentHeadMessageId: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NativeLiveConversation = {
  id: string;
  userId: string;
  title: string | null;
  lifecycleStatus: ConversationLifecycleStatus;
  currentHeadMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: NativeLiveMessage[];
};

export type NativeLiveProviderCheckpoint = {
  id: string;
  conversationId: string;
  canonicalMessageId: string;
  provider: ConversationRuntimeProvider;
  providerSessionId: string;
  providerCheckpointId: string | null;
  createdAt: string;
};

export type NativeLiveProviderCheckpointInput = {
  provider: ConversationRuntimeProvider;
  providerSessionId: string;
  providerCheckpointId?: string | null;
  runtimeMetadata?: Record<string, unknown> | null;
};
