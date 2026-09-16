import type {
  ConversationProvider,
  NormalizedConversationResult,
} from "./conversation-types.js";

export class ConversationProviderParseError extends Error {
  readonly code = "INVALID_CONVERSATION_EXPORT" as const;

  constructor(message: string) {
    super(message);
    this.name = "ConversationProviderParseError";
  }
}

export interface ConversationProviderParser {
  readonly provider: ConversationProvider;
  canParseConversation(value: unknown): boolean;
  normalizeConversation(value: unknown): NormalizedConversationResult;
}
