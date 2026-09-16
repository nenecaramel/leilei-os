import type {
  ConversationImportHistoryDetail,
  ConversationImportHistoryListItem,
  ConversationImportHistoryRepository,
} from "./conversation-import-history-repository.js";
import type { ConversationProvider } from "../../database/schema.js";

export class ConversationImportHistoryError extends Error {
  constructor(
    public readonly code:
      | "CONVERSATION_IMPORT_HISTORY_INVALID_REQUEST"
      | "CONVERSATION_IMPORT_HISTORY_NOT_FOUND"
      | "CONVERSATION_IMPORT_HISTORY_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "ConversationImportHistoryError";
  }
}

function provider(value: unknown): ConversationProvider | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "chatgpt" || value === "claude") return value;
  throw new ConversationImportHistoryError(
    "CONVERSATION_IMPORT_HISTORY_INVALID_REQUEST",
    "Conversation import history provider is invalid.",
  );
}

function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConversationImportHistoryError(
      "CONVERSATION_IMPORT_HISTORY_INVALID_REQUEST",
      "Conversation import history pagination is invalid.",
    );
  }
  return parsed;
}

function uuid(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw new ConversationImportHistoryError(
      "CONVERSATION_IMPORT_HISTORY_INVALID_REQUEST",
      "Conversation import source id is invalid.",
    );
  }
  return value;
}

export class ConversationImportHistoryService {
  constructor(
    private readonly repository: ConversationImportHistoryRepository,
  ) {}

  async list(input: {
    userId: string;
    provider?: unknown;
    limit?: unknown;
    offset?: unknown;
  }): Promise<{ items: ConversationImportHistoryListItem[]; total: number }> {
    await this.requireActive(input.userId);
    return this.repository.listSources({
      userId: input.userId,
      provider: provider(input.provider),
      limit: boundedInt(input.limit, 50, 1, 100),
      offset: boundedInt(input.offset, 0, 0, 100_000),
    });
  }

  async get(input: {
    userId: string;
    sourceId: unknown;
  }): Promise<ConversationImportHistoryDetail> {
    await this.requireActive(input.userId);
    const source = await this.repository.getSource({
      userId: input.userId,
      sourceId: uuid(input.sourceId),
    });
    if (!source) {
      throw new ConversationImportHistoryError(
        "CONVERSATION_IMPORT_HISTORY_NOT_FOUND",
        "Conversation import source was not found.",
      );
    }
    return source;
  }

  private async requireActive(userId: string): Promise<void> {
    if (await this.repository.findUserStatus(userId) !== "active") {
      throw new ConversationImportHistoryError(
        "CONVERSATION_IMPORT_HISTORY_UNAVAILABLE",
        "Conversation import history is unavailable.",
      );
    }
  }
}
