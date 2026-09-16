import type {
  ConversationExclusionListItem,
  ConversationExclusionManagementRepository,
} from "./conversation-exclusion-management-repository.js";
import type {
  ConversationExclusionScope,
  ConversationProvider,
} from "../../database/schema.js";

export class ConversationExclusionManagementError extends Error {
  constructor(
    public readonly code:
      | "CONVERSATION_EXCLUSION_INVALID_REQUEST"
      | "CONVERSATION_EXCLUSION_NOT_FOUND"
      | "CONVERSATION_EXCLUSION_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "ConversationExclusionManagementError";
  }
}

function uuid(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw new ConversationExclusionManagementError(
      "CONVERSATION_EXCLUSION_INVALID_REQUEST",
      `${label} is invalid.`,
    );
  }
  return value;
}

function provider(value: unknown): ConversationProvider | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "chatgpt" || value === "claude") return value;
  throw new ConversationExclusionManagementError(
    "CONVERSATION_EXCLUSION_INVALID_REQUEST",
    "Conversation exclusion provider is invalid.",
  );
}

function scope(value: unknown): ConversationExclusionScope | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "conversation" || value === "branch") return value;
  throw new ConversationExclusionManagementError(
    "CONVERSATION_EXCLUSION_INVALID_REQUEST",
    "Conversation exclusion scope is invalid.",
  );
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConversationExclusionManagementError(
      "CONVERSATION_EXCLUSION_INVALID_REQUEST",
      "Conversation exclusion pagination is invalid.",
    );
  }
  return parsed;
}

export class ConversationExclusionManagementService {
  constructor(
    private readonly repository: ConversationExclusionManagementRepository,
  ) {}

  async list(input: {
    userId: string;
    provider?: unknown;
    scope?: unknown;
    limit?: unknown;
    offset?: unknown;
  }): Promise<{ items: ConversationExclusionListItem[]; total: number }> {
    await this.requireActive(input.userId);
    return this.repository.listExclusions({
      userId: input.userId,
      provider: provider(input.provider),
      scope: scope(input.scope),
      limit: boundedInt(input.limit, 50, 1, 100),
      offset: boundedInt(input.offset, 0, 0, 100_000),
    });
  }

  async remove(input: {
    userId: string;
    exclusionId: unknown;
  }): Promise<{
    removed: true;
    exclusion: ConversationExclusionListItem;
    canonicalRestored: false;
    eligibleOnNextImport: true;
  }> {
    await this.requireActive(input.userId);
    const exclusion = await this.repository.deleteExclusion({
      userId: input.userId,
      exclusionId: uuid(input.exclusionId, "exclusionId"),
    });
    if (!exclusion) {
      throw new ConversationExclusionManagementError(
        "CONVERSATION_EXCLUSION_NOT_FOUND",
        "Conversation exclusion was not found.",
      );
    }
    return {
      removed: true,
      exclusion,
      canonicalRestored: false,
      eligibleOnNextImport: true,
    };
  }

  private async requireActive(userId: string): Promise<void> {
    if (await this.repository.findUserStatus(userId) !== "active") {
      throw new ConversationExclusionManagementError(
        "CONVERSATION_EXCLUSION_UNAVAILABLE",
        "Conversation exclusion management is unavailable.",
      );
    }
  }
}
