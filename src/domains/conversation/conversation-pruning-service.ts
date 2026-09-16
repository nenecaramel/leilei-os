import type {
  ConversationPruneBranchResult,
  ConversationPruneConversationResult,
  ConversationPruningRepository,
} from "./conversation-pruning-repository.js";

export class ConversationPruningError extends Error {
  constructor(
    public readonly code:
      | "CONVERSATION_PRUNE_NOT_FOUND"
      | "CONVERSATION_PRUNE_INVALID_REQUEST"
      | "CONVERSATION_PRUNE_UNAVAILABLE"
      | "CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "ConversationPruningError";
  }
}

function uuid(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw new ConversationPruningError(
      "CONVERSATION_PRUNE_INVALID_REQUEST",
      `${label} is invalid.`,
    );
  }
  return value;
}

export class ConversationPruningService {
  constructor(private readonly repository: ConversationPruningRepository) {}

  async deleteConversation(input: {
    userId: string;
    conversationId: unknown;
  }): Promise<ConversationPruneConversationResult & { rawSourcePreserved: true }> {
    await this.requireActive(input.userId);
    const result = await this.repository.pruneConversation({
      userId: input.userId,
      conversationId: uuid(input.conversationId, "conversationId"),
    });
    if (!result) {
      throw new ConversationPruningError(
        "CONVERSATION_PRUNE_NOT_FOUND",
        "Conversation was not found.",
      );
    }
    return { ...result, rawSourcePreserved: true };
  }

  async deleteBranch(input: {
    userId: string;
    conversationId: unknown;
    messageId: unknown;
  }): Promise<ConversationPruneBranchResult & { rawSourcePreserved: true }> {
    await this.requireActive(input.userId);
    try {
      const result = await this.repository.pruneBranch({
        userId: input.userId,
        conversationId: uuid(input.conversationId, "conversationId"),
        messageId: uuid(input.messageId, "messageId"),
      });
      if (!result) {
        throw new ConversationPruningError(
          "CONVERSATION_PRUNE_NOT_FOUND",
          "Conversation branch was not found.",
        );
      }
      return { ...result, rawSourcePreserved: true };
    } catch (error) {
      if (
        typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: unknown }).code === "CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED"
      ) {
        throw new ConversationPruningError(
          "CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED",
          "This branch contains the whole conversation.",
        );
      }
      throw error;
    }
  }

  private async requireActive(userId: string): Promise<void> {
    if (await this.repository.findUserStatus(userId) !== "active") {
      throw new ConversationPruningError(
        "CONVERSATION_PRUNE_UNAVAILABLE",
        "Conversation pruning is unavailable.",
      );
    }
  }
}
