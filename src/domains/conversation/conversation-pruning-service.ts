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
      | "CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED"
      | "CONVERSATION_PRUNE_ACTION_NOT_AVAILABLE",
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

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConversationPruningError(
      "CONVERSATION_PRUNE_INVALID_REQUEST",
      "Conversation pagination is invalid.",
    );
  }
  return parsed;
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

  async archiveConversation(input: { userId: string; conversationId: unknown }): Promise<{ archived: true }> {
    await this.requireActive(input.userId);
    const id = uuid(input.conversationId, "conversationId");
    if (!this.repository.archiveConversation || !await this.repository.archiveConversation({ userId: input.userId, conversationId: id })) {
      throw new ConversationPruningError("CONVERSATION_PRUNE_NOT_FOUND", "Conversation was not found.");
    }
    return { archived: true };
  }

  async restoreConversation(input: { userId: string; conversationId: unknown }): Promise<{ restored: true }> {
    await this.requireActive(input.userId);
    const id = uuid(input.conversationId, "conversationId");
    if (!this.repository.restoreConversation || !await this.repository.restoreConversation({ userId: input.userId, conversationId: id })) {
      throw new ConversationPruningError("CONVERSATION_PRUNE_NOT_FOUND", "Archived conversation was not found.");
    }
    return { restored: true };
  }

  async restoreDeletedConversation(input: { userId: string; conversationId: unknown }): Promise<{ restored: true }> {
    await this.requireActive(input.userId);
    const id = uuid(input.conversationId, "conversationId");
    if (!this.repository.restoreDeletedConversation || !await this.repository.restoreDeletedConversation({ userId: input.userId, conversationId: id })) {
      throw new ConversationPruningError("CONVERSATION_PRUNE_NOT_FOUND", "Deleted conversation was not found.");
    }
    return { restored: true };
  }

  async permanentlyDeleteConversation(input: { userId: string; conversationId: unknown }): Promise<{ deleted: true; rawSourcePreserved: true }> {
    await this.requireActive(input.userId);
    const id = uuid(input.conversationId, "conversationId");
    if (!this.repository.permanentDeleteConversation) throw new ConversationPruningError("CONVERSATION_PRUNE_ACTION_NOT_AVAILABLE", "Permanent delete is unavailable.");
    const result = await this.repository.permanentDeleteConversation({ userId: input.userId, conversationId: id });
    if (!result) throw new ConversationPruningError("CONVERSATION_PRUNE_NOT_FOUND", "Deleted conversation was not found.");
    return { deleted: true, rawSourcePreserved: true };
  }

  async restoreBranch(input: { userId: string; conversationId: unknown; branchId: unknown }): Promise<{ restored: true }> {
    await this.requireActive(input.userId);
    const conversationId = uuid(input.conversationId, "conversationId");
    const branchId = uuid(input.branchId, "branchId");
    if (!this.repository.restoreBranch || !await this.repository.restoreBranch({ userId: input.userId, conversationId, branchId })) {
      throw new ConversationPruningError("CONVERSATION_PRUNE_NOT_FOUND", "Deleted branch was not found.");
    }
    return { restored: true };
  }

  async permanentlyDeleteBranch(input: { userId: string; conversationId: unknown; branchId: unknown }): Promise<{ deleted: true; rawSourcePreserved: true }> {
    await this.requireActive(input.userId);
    const conversationId = uuid(input.conversationId, "conversationId");
    const branchId = uuid(input.branchId, "branchId");
    if (!this.repository.permanentDeleteBranch) throw new ConversationPruningError("CONVERSATION_PRUNE_ACTION_NOT_AVAILABLE", "Permanent delete is unavailable.");
    try {
      const result = await this.repository.permanentDeleteBranch({ userId: input.userId, conversationId, branchId });
      if (!result) throw new ConversationPruningError("CONVERSATION_PRUNE_NOT_FOUND", "Deleted branch was not found.");
      return { deleted: true, rawSourcePreserved: true };
    } catch (error) {
      if (error instanceof ConversationPruningError) throw error;
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED") {
        throw new ConversationPruningError("CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED", "This branch contains the whole conversation.");
      }
      throw error;
    }
  }

  async listDeletedBranches(input: { userId: string; limit?: unknown; offset?: unknown }) {
    await this.requireActive(input.userId);
    if (!this.repository.listDeletedBranches) throw new ConversationPruningError("CONVERSATION_PRUNE_ACTION_NOT_AVAILABLE", "Deleted branches are unavailable.");
    const limit = boundedInt(input.limit, 50, 1, 100);
    const offset = boundedInt(input.offset, 0, 0, 100_000);
    return this.repository.listDeletedBranches({ userId: input.userId, limit, offset });
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
