import type { ConversationProvider } from "./conversation-types.js";
import type {
  ConversationArchiveDetail,
  ConversationArchiveMessage,
  ConversationArchiveReadRepository,
  ConversationArchiveListItem,
  ConversationArchiveMessagePayload,
  ConversationArchiveSearchRecord,
  ConversationDailyStat,
} from "./conversation-archive-read-repository.js";

export type ConversationArchiveSearchResult = Omit<
  ConversationArchiveSearchRecord,
  "displayText"
> & {
  snippet: string;
};

export type ConversationModelMessage = ConversationArchiveMessage & ConversationArchiveMessagePayload;

export type ConversationModelView = {
  conversation: ConversationArchiveDetail;
  representation: "canonical_model_view";
  view: "default" | "all";
  pathBasis: "current_path" | "branch_inclusive";
  items: ConversationModelMessage[];
  total: number;
  offset: number;
  anchorIndex: number | null;
  hasMore: boolean;
  nextOffset: number | null;
};

export type ConversationMessageContext = {
  items: ConversationArchiveMessage[];
  total: number;
  offset: number;
  anchorIndex: number;
};

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

function searchRole(value: unknown): "user" | "assistant" | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "user" || value === "assistant") return value;
  throw new ConversationArchiveReadError(
    "CONVERSATION_INVALID_REQUEST",
    "Conversation role is invalid.",
  );
}

function searchQuery(value: unknown): string {
  if (typeof value !== "string") {
    throw new ConversationArchiveReadError(
      "CONVERSATION_INVALID_REQUEST",
      "Conversation search query is invalid.",
    );
  }
  const query = value.normalize("NFC").trim();
  if (!query || query.length > 500) {
    throw new ConversationArchiveReadError(
      "CONVERSATION_INVALID_REQUEST",
      "Conversation search query is invalid.",
    );
  }
  return query;
}

function optionalDate(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return dateOnly(value, name);
}

function snippet(text: string, query: string): string {
  const max = 360;
  if (text.length <= max) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  const center = index >= 0 ? index : 0;
  const start = Math.max(0, center - 120);
  const end = Math.min(text.length, start + max);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new ConversationArchiveReadError(
    "CONVERSATION_INVALID_REQUEST",
    `${label} is invalid.`,
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

function lifecycleScope(value: unknown): "active" | "archived" | "deleted" {
  if (value === undefined || value === null || value === "" || value === "active") return "active";
  if (value === "archived" || value === "deleted") return value;
  throw new ConversationArchiveReadError("CONVERSATION_INVALID_REQUEST", "Conversation lifecycle scope is invalid.");
}

function optionalBranchId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return uuid(value);
}

export class ConversationArchiveReadService {
  constructor(private readonly repository: ConversationArchiveReadRepository) {}

  async list(input: {
    userId: string;
    provider?: unknown;
    limit?: unknown;
    offset?: unknown;
    scope?: unknown;
  }): Promise<{ items: ConversationArchiveListItem[]; total: number }> {
    await this.requireActive(input.userId);
    return this.repository.listConversations({
      userId: input.userId,
      provider: provider(input.provider),
      limit: boundedInt(input.limit, 50, 1, 100),
      offset: boundedInt(input.offset, 0, 0, 100_000),
      scope: lifecycleScope(input.scope),
    });
  }

  async detail(input: {
    userId: string;
    conversationId: unknown;
    scope?: unknown;
    branchId?: unknown;
  }): Promise<ConversationArchiveDetail> {
    await this.requireActive(input.userId);
    const scope = lifecycleScope(input.scope);
    const branchId = optionalBranchId(input.branchId);
    if (branchId && scope !== "deleted") {
      throw new ConversationArchiveReadError("CONVERSATION_INVALID_REQUEST", "Branch scope is invalid.");
    }
    const result = await this.repository.getConversation({
      userId: input.userId,
      conversationId: uuid(input.conversationId),
      scope,
      branchId,
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
    scope?: unknown;
    branchId?: unknown;
  }): Promise<{ items: ConversationArchiveMessage[]; total: number }> {
    await this.requireActive(input.userId);
    const conversationId = uuid(input.conversationId);
    const scope = lifecycleScope(input.scope);
    const branchId = optionalBranchId(input.branchId);
    if (branchId && scope !== "deleted") {
      throw new ConversationArchiveReadError("CONVERSATION_INVALID_REQUEST", "Branch scope is invalid.");
    }
    const detail = await this.repository.getConversation({
      userId: input.userId,
      conversationId,
      scope,
      branchId,
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
      scope,
      branchId,
    });
  }

  async search(input: {
    userId: string;
    query: unknown;
    provider?: unknown;
    role?: unknown;
    conversationId?: unknown;
    from?: unknown;
    to?: unknown;
    timeZone?: unknown;
    favoritesOnly?: unknown;
    limit?: unknown;
    offset?: unknown;
    scope?: unknown;
  }): Promise<{ items: ConversationArchiveSearchResult[]; total: number }> {
    await this.requireActive(input.userId);
    const query = searchQuery(input.query);
    const from = optionalDate(input.from, "from");
    const to = optionalDate(input.to, "to");
    if (from && to && from > to) {
      throw new ConversationArchiveReadError(
        "CONVERSATION_INVALID_REQUEST",
        "Conversation date range is invalid.",
      );
    }
    const zone = from || to ? timeZone(input.timeZone) : undefined;
    const conversationId = input.conversationId === undefined
      || input.conversationId === null
      || input.conversationId === ""
        ? undefined
        : uuid(input.conversationId);

    const result = await this.repository.searchMessages({
      userId: input.userId,
      query,
      provider: provider(input.provider),
      role: searchRole(input.role),
      conversationId,
      from,
      to,
      timeZone: zone,
      favoritesOnly: optionalBoolean(input.favoritesOnly, "favoritesOnly"),
      limit: boundedInt(input.limit, 50, 1, 100),
      offset: boundedInt(input.offset, 0, 0, 1_000_000),
      scope: lifecycleScope(input.scope),
    });
    return {
      total: result.total,
      items: result.items.map(({ displayText, ...item }) => ({
        ...item,
        snippet: snippet(displayText, query),
      })),
    };
  }

  async messageContext(input: {
    userId: string;
    conversationId: unknown;
    messageId: unknown;
    view?: unknown;
    radius?: unknown;
    scope?: unknown;
    branchId?: unknown;
  }): Promise<ConversationMessageContext> {
    await this.requireActive(input.userId);
    const conversationId = uuid(input.conversationId);
    const messageId = uuid(input.messageId);
    const scope = lifecycleScope(input.scope);
    const branchId = optionalBranchId(input.branchId);
    if (branchId && scope !== "deleted") {
      throw new ConversationArchiveReadError("CONVERSATION_INVALID_REQUEST", "Branch scope is invalid.");
    }
    const detail = await this.repository.getConversation({
      userId: input.userId,
      conversationId,
      scope,
      branchId,
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
    const radius = boundedInt(input.radius, 20, 1, 100);
    const ordinal = await this.repository.findMessageOrdinal({
      userId: input.userId,
      conversationId,
      provider: detail.provider,
      view,
      messageId,
      branchId,
    });
    if (!ordinal) {
      throw new ConversationArchiveReadError(
        "CONVERSATION_NOT_FOUND",
        "Conversation message was not found.",
      );
    }
    const offset = Math.max(0, ordinal.index - radius);
    const result = await this.repository.listMessages({
      userId: input.userId,
      conversationId,
      provider: detail.provider,
      view,
      limit: radius * 2 + 1,
      offset,
      scope,
      branchId,
    });
    return {
      items: result.items,
      total: ordinal.total,
      offset,
      anchorIndex: ordinal.index - offset,
    };
  }

  async modelView(input: {
    userId: string;
    conversationId: unknown;
    messageId?: unknown;
    view?: unknown;
    context?: unknown;
    limit?: unknown;
    offset?: unknown;
  }): Promise<ConversationModelView> {
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

    let page: { items: ConversationArchiveMessage[]; total: number };
    let offset: number;
    let anchorIndex: number | null = null;

    if (input.messageId !== undefined && input.messageId !== null && input.messageId !== "") {
      const messageId = uuid(input.messageId);
      const context = boundedInt(input.context, 20, 0, 100);
      const ordinal = await this.repository.findMessageOrdinal({
        userId: input.userId,
        conversationId,
        provider: detail.provider,
        view,
        messageId,
      });
      if (!ordinal) {
        throw new ConversationArchiveReadError(
          "CONVERSATION_NOT_FOUND",
          "Conversation message was not found.",
        );
      }
      offset = Math.max(0, ordinal.index - context);
      page = await this.repository.listMessages({
        userId: input.userId,
        conversationId,
        provider: detail.provider,
        view,
        limit: context * 2 + 1,
        offset,
      });
      anchorIndex = ordinal.index - offset;
    } else {
      offset = boundedInt(input.offset, 0, 0, 1_000_000);
      page = await this.repository.listMessages({
        userId: input.userId,
        conversationId,
        provider: detail.provider,
        view,
        limit: boundedInt(input.limit, 40, 1, 100),
        offset,
      });
    }

    const payloads = await this.repository.readMessagePayloads({
      userId: input.userId,
      messageIds: page.items.map((item) => item.id),
    });
    const items = page.items.map((item) => ({
      ...item,
      ...(payloads[item.id] ?? { contentBlocks: [], attachments: [] }),
    }));
    const consumed = offset + items.length;

    return {
      conversation: detail,
      representation: "canonical_model_view",
      view,
      pathBasis: detail.provider === "chatgpt" && view === "default"
        ? "current_path"
        : "branch_inclusive",
      items,
      total: page.total,
      offset,
      anchorIndex,
      hasMore: consumed < page.total,
      nextOffset: consumed < page.total ? consumed : null,
    };
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
