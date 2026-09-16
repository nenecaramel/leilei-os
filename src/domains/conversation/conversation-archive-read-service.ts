import type { ConversationProvider } from "./conversation-types.js";
import type {
  ConversationArchiveDetail,
  ConversationArchiveMessage,
  ConversationArchiveReadRepository,
  ConversationArchiveListItem,
  ConversationDailyStat,
} from "./conversation-archive-read-repository.js";

export class ConversationArchiveReadError extends Error {
  constructor(
    public readonly code:
      | "CONVERSATION_NOT_FOUND"
      | "CONVERSATION_INVALID_REQUEST"
      | "CONVERSATION_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "ConversationArchiveReadError";
  }
}

function provider(value: unknown): ConversationProvider | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "chatgpt" || value === "claude") return value;
  throw new ConversationArchiveReadError(
    "CONVERSATION_INVALID_REQUEST",
    "Conversation provider is invalid.",
  );
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConversationArchiveReadError(
      "CONVERSATION_INVALID_REQUEST",
      "Conversation pagination is invalid.",
    );
  }
  return parsed;
}

function dateOnly(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new ConversationArchiveReadError(
      "CONVERSATION_INVALID_REQUEST",
      `${name} is invalid.`,
    );
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ConversationArchiveReadError(
      "CONVERSATION_INVALID_REQUEST",
      `${name} is invalid.`,
    );
  }
  return value;
}

function timeZone(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 100) {
    throw new ConversationArchiveReadError(
      "CONVERSATION_INVALID_REQUEST",
      "Conversation time zone is invalid.",
    );
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
  } catch {
    throw new ConversationArchiveReadError(
      "CONVERSATION_INVALID_REQUEST",
      "Conversation time zone is invalid.",
    );
  }
  return value;
}

function uuid(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw new ConversationArchiveReadError(
      "CONVERSATION_INVALID_REQUEST",
      "Conversation id is invalid.",
    );
  }
  return value;
}

export class ConversationArchiveReadService {
  constructor(private readonly repository: ConversationArchiveReadRepository) {}

  async list(input: {
    userId: string;
    provider?: unknown;
    limit?: unknown;
    offset?: unknown;
  }): Promise<{ items: ConversationArchiveListItem[]; total: number }> {
    await this.requireActive(input.userId);
    return this.repository.listConversations({
      userId: input.userId,
      provider: provider(input.provider),
      limit: boundedInt(input.limit, 50, 1, 100),
      offset: boundedInt(input.offset, 0, 0, 100_000),
    });
  }

  async detail(input: {
    userId: string;
    conversationId: unknown;
  }): Promise<ConversationArchiveDetail> {
    await this.requireActive(input.userId);
    const result = await this.repository.getConversation({
      userId: input.userId,
      conversationId: uuid(input.conversationId),
    });
    if (!result) {
      throw new ConversationArchiveReadError(
        "CONVERSATION_NOT_FOUND",
        "Conversation was not found.",
      );
    }
    return result;
  }

  async messages(input: {
    userId: string;
    conversationId: unknown;
    view?: unknown;
    limit?: unknown;
    offset?: unknown;
  }): Promise<{ items: ConversationArchiveMessage[]; total: number }> {
    await this.requireActive(input.userId);
    const conversationId = uuid(input.conversationId);
    const detail = await this.repository.getConversation({
      userId: input.userId,
      conversationId,
    });
    if (!detail) {
      throw new ConversationArchiveReadError(
        "CONVERSATION_NOT_FOUND",
        "Conversation was not found.",
      );
    }
    const view = input.view === undefined || input.view === "" || input.view === "default"
      ? "default"
      : input.view === "all"
        ? "all"
        : null;
    if (!view) {
      throw new ConversationArchiveReadError(
        "CONVERSATION_INVALID_REQUEST",
        "Conversation message view is invalid.",
      );
    }
    return this.repository.listMessages({
      userId: input.userId,
      conversationId,
      provider: detail.provider,
      view,
      limit: boundedInt(input.limit, 200, 1, 500),
      offset: boundedInt(input.offset, 0, 0, 1_000_000),
    });
  }

  async stats(input: {
    userId: string;
    from: unknown;
    to: unknown;
    timeZone: unknown;
  }): Promise<ConversationDailyStat[]> {
    await this.requireActive(input.userId);
    const from = dateOnly(input.from, "from");
    const to = dateOnly(input.to, "to");
    if (from > to) {
      throw new ConversationArchiveReadError(
        "CONVERSATION_INVALID_REQUEST",
        "Conversation date range is invalid.",
      );
    }
    const days = Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`))
      / 86_400_000,
    );
    if (days > 366) {
      throw new ConversationArchiveReadError(
        "CONVERSATION_INVALID_REQUEST",
        "Conversation date range is too large.",
      );
    }
    return this.repository.dailyStats({
      userId: input.userId,
      from,
      to,
      timeZone: timeZone(input.timeZone),
    });
  }

  private async requireActive(userId: string): Promise<void> {
    const status = await this.repository.findUserStatus(userId);
    if (status !== "active") {
      throw new ConversationArchiveReadError(
        "CONVERSATION_UNAVAILABLE",
        "Conversation Archive is unavailable.",
      );
    }
  }
}
