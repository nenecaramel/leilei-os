export class ConversationFavoriteRangeError extends Error {
  constructor(
    public readonly code:
      | "CONVERSATION_FAVORITE_RANGE_NOT_FOUND"
      | "CONVERSATION_FAVORITE_RANGE_TOO_LARGE",
  ) {
    super(code);
    this.name = "ConversationFavoriteRangeError";
  }
}

export function selectConversationFavoriteRange<T extends { id: string }>(
  messages: readonly T[],
  startMessageId: string,
  endMessageId: string,
  maxMessages = 200,
): T[] {
  const startIndex = messages.findIndex((message) => message.id === startMessageId);
  const endIndex = messages.findIndex((message) => message.id === endMessageId);
  if (startIndex < 0 || endIndex < 0) {
    throw new ConversationFavoriteRangeError("CONVERSATION_FAVORITE_RANGE_NOT_FOUND");
  }
  const lower = Math.min(startIndex, endIndex);
  const upper = Math.max(startIndex, endIndex);
  const selected = messages.slice(lower, upper + 1);
  if (selected.length > maxMessages) {
    throw new ConversationFavoriteRangeError("CONVERSATION_FAVORITE_RANGE_TOO_LARGE");
  }
  return selected;
}
