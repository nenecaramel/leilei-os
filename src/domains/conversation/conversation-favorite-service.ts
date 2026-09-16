import type {
  ConversationFavoriteDetail,
  ConversationFavoriteListItem,
  ConversationFavoriteRepository,
} from "./conversation-favorite-repository.js";
import type {
  ConversationFavoriteView,
  ConversationProvider,
} from "../../database/schema.js";

export class ConversationFavoriteError extends Error {
  constructor(
    public readonly code:
      | "CONVERSATION_FAVORITE_INVALID_REQUEST"
      | "CONVERSATION_FAVORITE_NOT_FOUND"
      | "CONVERSATION_FAVORITE_RANGE_TOO_LARGE"
      | "CONVERSATION_FAVORITE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "ConversationFavoriteError";
  }
}

function uuid(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw new ConversationFavoriteError(
      "CONVERSATION_FAVORITE_INVALID_REQUEST",
      `${label} is invalid.`,
    );
  }
  return value;
}

function provider(value: unknown): ConversationProvider | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "chatgpt" || value === "claude") return value;
  throw new ConversationFavoriteError(
    "CONVERSATION_FAVORITE_INVALID_REQUEST",
    "Conversation provider is invalid.",
  );
}

function view(value: unknown): ConversationFavoriteView {
  if (value === undefined || value === null || value === "" || value === "default") {
    return "default";
  }
  if (value === "all") return "all";
  throw new ConversationFavoriteError(
    "CONVERSATION_FAVORITE_INVALID_REQUEST",
    "Conversation favorite view is invalid.",
  );
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConversationFavoriteError(
      "CONVERSATION_FAVORITE_INVALID_REQUEST",
      "Conversation favorite pagination is invalid.",
    );
  }
  return parsed;
}

function optionalUuid(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return uuid(value, label);
}

function optionalText(
  value: unknown,
  label: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ConversationFavoriteError(
      "CONVERSATION_FAVORITE_INVALID_REQUEST",
      `${label} is invalid.`,
    );
  }
  const normalized = value.normalize("NFC").trim();
  if (normalized.length > maxLength) {
    throw new ConversationFavoriteError(
      "CONVERSATION_FAVORITE_INVALID_REQUEST",
      `${label} is too long.`,
    );
  }
  return normalized || null;
}

function tags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new ConversationFavoriteError(
      "CONVERSATION_FAVORITE_INVALID_REQUEST",
      "Conversation favorite tags are invalid.",
    );
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") {
      throw new ConversationFavoriteError(
        "CONVERSATION_FAVORITE_INVALID_REQUEST",
        "Conversation favorite tags are invalid.",
      );
    }
    const normalized = raw.normalize("NFC").trim();
    if (!normalized || normalized.length > 40) {
      throw new ConversationFavoriteError(
        "CONVERSATION_FAVORITE_INVALID_REQUEST",
        "Conversation favorite tags are invalid.",
      );
    }
    const key = normalized.toLocaleLowerCase("und");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function optionalTag(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = tags([value]);
  return normalized[0];
}

export class ConversationFavoriteService {
  constructor(private readonly repository: ConversationFavoriteRepository) {}

  async create(input: {
    userId: string;
    conversationId: unknown;
    startMessageId: unknown;
    endMessageId?: unknown;
    view?: unknown;
    title?: unknown;
    note?: unknown;
    tags?: unknown;
  }): Promise<ConversationFavoriteDetail> {
    await this.requireActive(input.userId);
    const startMessageId = uuid(input.startMessageId, "startMessageId");
    const endMessageId = input.endMessageId === undefined
      || input.endMessageId === null
      || input.endMessageId === ""
        ? startMessageId
        : uuid(input.endMessageId, "endMessageId");
    let favoriteId: string;
    try {
      favoriteId = await this.repository.createFavorite({
        userId: input.userId,
        conversationId: uuid(input.conversationId, "conversationId"),
        startMessageId,
        endMessageId,
        view: view(input.view),
        title: optionalText(input.title, "title", 200),
        note: optionalText(input.note, "note", 4000),
        tags: tags(input.tags),
      });
    } catch (error) {
      const code = typeof error === "object"
        && error !== null
        && "code" in error
        && typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : null;
      if (code === "CONVERSATION_FAVORITE_RANGE_TOO_LARGE") {
        throw new ConversationFavoriteError(
          "CONVERSATION_FAVORITE_RANGE_TOO_LARGE",
          "Conversation favorite range exceeds 200 messages.",
        );
      }
      if (code === "CONVERSATION_FAVORITE_RANGE_NOT_FOUND") {
        throw new ConversationFavoriteError(
          "CONVERSATION_FAVORITE_NOT_FOUND",
          "Conversation favorite range was not found.",
        );
      }
      throw error;
    }
    const result = await this.repository.getFavorite({
      userId: input.userId,
      favoriteId,
    });
    if (!result) throw new Error("Conversation favorite disappeared after creation.");
    return result;
  }

  async list(input: {
    userId: string;
    provider?: unknown;
    conversationId?: unknown;
    tag?: unknown;
    limit?: unknown;
    offset?: unknown;
  }): Promise<{ items: ConversationFavoriteListItem[]; total: number }> {
    await this.requireActive(input.userId);
    return this.repository.listFavorites({
      userId: input.userId,
      provider: provider(input.provider),
      conversationId: optionalUuid(input.conversationId, "conversationId"),
      tag: optionalTag(input.tag),
      limit: boundedInt(input.limit, 50, 1, 100),
      offset: boundedInt(input.offset, 0, 0, 100_000),
    });
  }

  async detail(input: {
    userId: string;
    favoriteId: unknown;
  }): Promise<ConversationFavoriteDetail> {
    await this.requireActive(input.userId);
    const result = await this.repository.getFavorite({
      userId: input.userId,
      favoriteId: uuid(input.favoriteId, "favoriteId"),
    });
    if (!result) {
      throw new ConversationFavoriteError(
        "CONVERSATION_FAVORITE_NOT_FOUND",
        "Conversation favorite was not found.",
      );
    }
    return result;
  }

  async update(input: {
    userId: string;
    favoriteId: unknown;
    title?: unknown;
    note?: unknown;
    tags?: unknown;
  }): Promise<ConversationFavoriteDetail> {
    await this.requireActive(input.userId);
    const hasTitle = Object.prototype.hasOwnProperty.call(input, "title");
    const hasNote = Object.prototype.hasOwnProperty.call(input, "note");
    const hasTags = Object.prototype.hasOwnProperty.call(input, "tags");
    if (!hasTitle && !hasNote && !hasTags) {
      throw new ConversationFavoriteError(
        "CONVERSATION_FAVORITE_INVALID_REQUEST",
        "Conversation favorite update is empty.",
      );
    }

    const favoriteId = uuid(input.favoriteId, "favoriteId");
    const updated = await this.repository.updateFavorite({
      userId: input.userId,
      favoriteId,
      ...(hasTitle ? { title: optionalText(input.title, "title", 200) } : {}),
      ...(hasNote ? { note: optionalText(input.note, "note", 4000) } : {}),
      ...(hasTags ? { tags: tags(input.tags) } : {}),
    });
    if (!updated) {
      throw new ConversationFavoriteError(
        "CONVERSATION_FAVORITE_NOT_FOUND",
        "Conversation favorite was not found.",
      );
    }
    return this.detail({ userId: input.userId, favoriteId });
  }

  async delete(input: {
    userId: string;
    favoriteId: unknown;
  }): Promise<{ deleted: true }> {
    await this.requireActive(input.userId);
    const deleted = await this.repository.deleteFavorite({
      userId: input.userId,
      favoriteId: uuid(input.favoriteId, "favoriteId"),
    });
    if (!deleted) {
      throw new ConversationFavoriteError(
        "CONVERSATION_FAVORITE_NOT_FOUND",
        "Conversation favorite was not found.",
      );
    }
    return { deleted: true };
  }

  private async requireActive(userId: string): Promise<void> {
    if (await this.repository.findUserStatus(userId) !== "active") {
      throw new ConversationFavoriteError(
        "CONVERSATION_FAVORITE_UNAVAILABLE",
        "Conversation favorites are unavailable.",
      );
    }
  }
}
