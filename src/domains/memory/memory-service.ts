import type {
  MemoryCategory,
  MemoryOrdering,
  MemoryRepository,
  MemoryUserRecord,
  MemoryDirectoryRecord,
} from "./memory-repository.js";
import { createBodyMatchSnippet, createLeadingPreview } from "../compact-text.js";
import { WEB_USER_LIFECYCLE_CONTEXT } from "../lifecycle/lifecycle-audit-repository.js";
import {
  hashMcpWriteRequest,
  normalizeMcpIdempotencyKey,
} from "../mcp-write/mcp-write-idempotency.js";
import {
  isContentAuthor,
  type ContentAuthor,
} from "../content-author.js";
import {
  MEMORY_CONTENT_MAX_LENGTH,
  MEMORY_KEY_MAX_LENGTH,
  MEMORY_TAGS_MAX_COUNT,
  MEMORY_TAG_MAX_LENGTH,
} from "../resource-limits.js";

const ALLOWED_CATEGORIES = [
  "profile",
  "preference",
  "goal",
  "project",
] as const satisfies readonly MemoryCategory[];

const DEFAULT_MEMORY_LIMIT = 50;
const MAX_MEMORY_LIMIT = 50;
const MAX_SEARCH_LENGTH = 200;
const MAX_CONTENT_LENGTH = MEMORY_CONTENT_MAX_LENGTH;
const MAX_TAGS = MEMORY_TAGS_MAX_COUNT;
const MAX_TAG_LENGTH = MEMORY_TAG_MAX_LENGTH;
const MAX_KEY_LENGTH = MEMORY_KEY_MAX_LENGTH;

export type ReadMemoryInput = {
  userId: string;
  categories?: readonly string[];
  keys?: readonly string[];
  query?: string;
  tag?: string;
  ordering?: MemoryOrdering;
  includeSource?: boolean;
  limit?: number;
};

export type CreateMemoryInput = {
  userId: string;
  category: MemoryCategory;
  key: string;
  content: string;
  tags?: readonly string[];
  author: ContentAuthor;
};

export type AuthenticatedMemoryContext = { userId: string };

export type CreateMcpMemoryInput = {
  category: MemoryCategory;
  key: string;
  content: string;
  tags?: readonly string[];
  author?: ContentAuthor;
};

export type CreateMcpMemoryResult = {
  memory: {
    id: string;
    category: MemoryCategory;
    key: string;
    content: string;
    tags: string[];
    source: "mcp";
    lifecycle_status: "active" | "archived";
    author: ContentAuthor | null;
    created_at: string;
    updated_at: string;
  };
  metadata: { created: boolean; idempotent_replay: boolean };
};

export type UpdateMemoryInput = {
  userId: string;
  id: string;
  key: string;
  category: MemoryCategory;
  content: string;
  tags?: readonly string[];
  author?: ContentAuthor;
};

export type UpdateMcpMemoryInput = {
  id: string;
  category?: MemoryCategory;
  key?: string;
  content?: string;
  tags?: readonly string[];
  author?: ContentAuthor;
};

export type ReadMemoryResult = {
  user: {
    display_name: string;
  };
  memories: Array<{
    id: string;
    category: MemoryCategory;
    key: string;
    content: string;
    tags: string[];
    source?: string;
    author: ContentAuthor | null;
    updated_at: string;
  }>;
  metadata: {
    count: number;
  };
};

export type MemoryDiscoveryItem = {
  id: string;
  category: MemoryCategory;
  key: string;
  tags: string[];
  author: ContentAuthor | null;
  updated_at: string;
  preview: string;
};

export type MemorySearchDiscoveryItem = Omit<MemoryDiscoveryItem, "preview"> & {
  snippet: string | null;
};

export type ReadMemoryDiscoveryResult = {
  user: { display_name: string };
  memories: MemoryDiscoveryItem[];
  metadata: { count: number };
};

export type SearchMemoryDiscoveryResult = {
  memories: MemorySearchDiscoveryItem[];
  metadata: { count: number };
};

export type ReadMemoryDetailResult =
  ReadMemoryResult["memories"][number];

export type ReadArchivedMemoriesResult = {
  memories: Array<{
    id: string;
    category: MemoryCategory;
    key: string;
    content: string;
    tags: string[];
    source: string;
    author: ContentAuthor | null;
    updated_at: string;
  }>;
  metadata: {
    count: number;
  };
};

export type MemoryDomainErrorCode =
  | "AUTHOR_REQUIRED"
  | "INVALID_MEMORY_CATEGORY"
  | "INVALID_MEMORY_LIMIT"
  | "INVALID_MEMORY_QUERY"
  | "INVALID_MEMORY_TAGS"
  | "INVALID_MEMORY_KEY"
  | "INVALID_MEMORY_CONTENT"
  | "INVALID_MEMORY_PATCH"
  | "INVALID_IDEMPOTENCY_KEY"
  | "IDEMPOTENCY_CONFLICT"
  | "MEMORY_KEY_CONFLICT"
  | "MEMORY_NOT_FOUND"
  | "USER_NOT_FOUND"
  | "USER_DISABLED";

export class MemoryDomainError extends Error {
  constructor(
    readonly code: MemoryDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MemoryDomainError";
  }
}

export class MemoryService {
  constructor(private readonly repository: MemoryRepository) {}

  async readMemory(input: ReadMemoryInput): Promise<ReadMemoryResult> {
    const user = await this.requireActiveUser(input.userId);

    const categories = this.validateCategories(input.categories);
    const keys = this.normalizeKeys(input.keys);
    const query = this.normalizeQuery(input.query);
    const tag = this.normalizeTagFilter(input.tag);
    const limit = this.resolveLimit(input.limit);

    const memories = await this.repository.findActiveAssistantMemories({
      userId: input.userId,
      query,
      categories,
      keys,
      tag,
      ordering: input.ordering ?? "default",
      limit,
    });

    return {
      user: {
        display_name: user.displayName,
      },
      memories: memories.map((memory) => ({
        id: memory.id,
        category: memory.category,
        key: memory.key,
        content: this.limitContent(memory.content),
        tags: memory.tags,
        ...(input.includeSource ? { source: memory.source } : {}),
        author: memory.author ?? null,
        updated_at: memory.updatedAt.toISOString(),
      })),
      metadata: {
        count: memories.length,
      },
    };
  }

  async readMemoryDiscovery(input: ReadMemoryInput): Promise<ReadMemoryDiscoveryResult> {
    const user = await this.requireActiveUser(input.userId);
    const categories = this.validateCategories(input.categories);
    const keys = this.normalizeKeys(input.keys);
    const query = this.normalizeQuery(input.query);
    const tag = this.normalizeTagFilter(input.tag);
    const limit = this.resolveLimit(input.limit);
    const memories = await this.repository.findActiveAssistantMemoryDirectory({
      userId: input.userId,
      query,
      categories,
      keys,
      tag,
      ordering: input.ordering ?? "default",
      limit,
    });

    return {
      user: { display_name: user.displayName },
      memories: memories.map((memory) => this.toDiscoveryItem(memory)),
      metadata: { count: memories.length },
    };
  }

  async searchMemoryDiscovery(input: ReadMemoryInput): Promise<SearchMemoryDiscoveryResult> {
    await this.requireActiveUser(input.userId);
    const categories = this.validateCategories(input.categories);
    const query = this.normalizeQuery(input.query);
    const tag = this.normalizeTagFilter(input.tag);
    const limit = this.resolveLimit(input.limit);
    const memories = await this.repository.findActiveAssistantMemorySearch({
      userId: input.userId,
      query,
      categories,
      tag,
      ordering: "updated_desc",
      limit,
    });

    return {
      memories: memories.map((memory) => ({
        id: memory.id,
        category: memory.category,
        key: memory.key,
        tags: memory.tags,
        author: memory.author ?? null,
        updated_at: memory.updatedAt.toISOString(),
        snippet: memory.bodyMatched
          ? createBodyMatchSnippet(memory.bodyExcerpt, query ?? "")
          : null,
      })),
      metadata: { count: memories.length },
    };
  }

  async listAvailableCategories(
    userId: string,
  ): Promise<MemoryCategory[]> {
    await this.requireActiveUser(userId);
    return this.repository.findActiveAssistantMemoryCategories(userId);
  }

  async listAvailableTags(userId: string): Promise<string[]> {
    await this.requireActiveUser(userId);
    return this.repository.findActiveAssistantMemoryTags(userId);
  }

  async readMemoryDetail(input: {
    userId: string;
    id: string;
  }): Promise<ReadMemoryDetailResult> {
    await this.requireActiveUser(input.userId);
    const id = input.id.trim();

    if (!id) {
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Memory was not found.",
      );
    }

    const memory =
      await this.repository.findActiveAssistantMemoryById({
        userId: input.userId,
        id,
      });

    if (!memory) {
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Memory was not found.",
      );
    }

    return {
      id: memory.id,
      category: memory.category,
      key: memory.key,
      content: this.limitContent(memory.content),
      tags: memory.tags,
      source: memory.source,
      author: memory.author ?? null,
      updated_at: memory.updatedAt.toISOString(),
    };
  }

  async readArchivedMemories(input: {
    userId: string;
    limit?: number;
  }): Promise<ReadArchivedMemoriesResult> {
    await this.requireActiveUser(input.userId);
    const limit = this.resolveLimit(input.limit);
    const memories =
      await this.repository.findArchivedAssistantMemories({
        userId: input.userId,
        limit,
      });

    return {
      memories: memories.map((memory) => ({
        id: memory.id,
        category: memory.category,
        key: memory.key,
        content: this.limitContent(memory.content),
        tags: memory.tags,
        source: memory.source,
        author: memory.author ?? null,
        updated_at: memory.updatedAt.toISOString(),
      })),
      metadata: {
        count: memories.length,
      },
    };
  }

  async readArchivedMemoryDetail(input: {
    userId: string;
    id: string;
  }): Promise<ReadMemoryDetailResult> {
    await this.requireActiveUser(input.userId);
    const id = input.id.trim();

    if (!id) {
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Memory was not found.",
      );
    }

    const memory =
      await this.repository.findArchivedAssistantMemoryById({
        userId: input.userId,
        id,
      });

    if (!memory) {
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Memory was not found.",
      );
    }

    return {
      id: memory.id,
      category: memory.category,
      key: memory.key,
      content: memory.content,
      tags: memory.tags,
      source: memory.source,
      author: memory.author ?? null,
      updated_at: memory.updatedAt.toISOString(),
    };
  }

  async createMemory(input: CreateMemoryInput): Promise<void> {
    await this.requireActiveUser(input.userId);
    const category = this.validateCategories([input.category])![0]!;
    const key = this.normalizeRequiredText(input.key, MAX_KEY_LENGTH, "INVALID_MEMORY_KEY");
    const content = this.normalizeRequiredText(input.content, MAX_CONTENT_LENGTH, "INVALID_MEMORY_CONTENT");
    this.requireAuthor(input.author);
    await this.repository.createMemory({
      userId: input.userId,
      category,
      key,
      content,
      tags: this.normalizeTags(input.tags ?? []),
      source: "web",
      author: input.author,
    });
  }

  async createMcpMemory(
    context: AuthenticatedMemoryContext,
    input: CreateMcpMemoryInput,
    idempotencyKey: string,
  ): Promise<CreateMcpMemoryResult> {
    await this.requireActiveUser(context.userId);
    const userId = context.userId.trim();
    const category = this.validateCategories([input.category])![0]!;
    const key = this.normalizeRequiredText(input.key, MAX_KEY_LENGTH, "INVALID_MEMORY_KEY");
    const content = this.normalizeRequiredText(input.content, MAX_CONTENT_LENGTH, "INVALID_MEMORY_CONTENT");
    const tags = this.normalizeTags(input.tags ?? []);
    this.requireAuthor(input.author);
    let normalizedIdempotencyKey: string;
    try {
      normalizedIdempotencyKey = normalizeMcpIdempotencyKey(idempotencyKey);
    } catch {
      throw new MemoryDomainError("INVALID_IDEMPOTENCY_KEY", "The idempotency key is invalid.");
    }

    const repository = this.repository.createMemoryIdempotently;
    if (!repository) throw new Error("Memory idempotency persistence is unavailable.");
    const persisted = await repository.call(this.repository, {
      userId,
      category,
      key,
      content,
      tags,
      author: input.author!,
      source: "mcp",
      idempotencyKey: normalizedIdempotencyKey,
      requestHash: hashMcpWriteRequest({ category, key, content, tags, author: input.author! }),
    });

    if (persisted.outcome === "conflict") {
      throw new MemoryDomainError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used for different Memory content.");
    }
    if (persisted.outcome === "key_conflict") {
      throw new MemoryDomainError("MEMORY_KEY_CONFLICT", "The Memory key already exists.");
    }
    if (persisted.outcome !== "created" && persisted.outcome !== "replayed") {
      throw new Error("Unexpected Memory persistence outcome.");
    }

    return {
      memory: {
        id: persisted.memory.id,
        category: persisted.memory.category,
        key: persisted.memory.key,
        content: persisted.memory.content,
        tags: persisted.memory.tags,
        source: "mcp",
        lifecycle_status: persisted.memory.status,
        created_at: persisted.memory.createdAt.toISOString(),
        updated_at: persisted.memory.updatedAt.toISOString(),
        author: persisted.memory.author ?? null,
      },
      metadata: {
        created: persisted.outcome === "created",
        idempotent_replay: persisted.outcome === "replayed",
      },
    };
  }

  async updateMemory(input: UpdateMemoryInput): Promise<void> {
    await this.requireActiveUser(input.userId);
    const category = this.validateCategories([input.category])![0]!;
    const key = this.normalizeRequiredText(
      input.key,
      MAX_KEY_LENGTH,
      "INVALID_MEMORY_KEY",
    );
    const content = this.normalizeRequiredText(
      input.content,
      MAX_CONTENT_LENGTH,
      "INVALID_MEMORY_CONTENT",
    );
    const tags = input.tags === undefined
      ? undefined
      : this.normalizeTags(input.tags);
    const existing = await this.repository.findActiveAssistantMemoryById({
      userId: input.userId,
      id: input.id.trim(),
    });
    if (!existing) {
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Memory was not found.",
      );
    }
    const author = input.author ?? existing.author ?? null;
    this.requireAuthor(author);
    const updated = await this.repository.updateMemory({
      userId: input.userId,
      id: input.id,
      key,
      category,
      content,
      ...(tags === undefined ? {} : { tags }),
      author,
    });

    if (!updated) {
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Memory was not found.",
      );
    }
  }

  async updateMcpMemory(
    context: AuthenticatedMemoryContext,
    input: UpdateMcpMemoryInput,
  ): Promise<ReadMemoryDetailResult> {
    await this.requireActiveUser(context.userId);
    const id = input.id.trim();
    if (!id) {
      throw new MemoryDomainError("MEMORY_NOT_FOUND", "Memory was not found.");
    }

    let hasPatch = false;
    const patch: {
      category?: MemoryCategory;
      key?: string;
      content?: string;
      tags?: string[];
      author?: ContentAuthor;
    } = {};
    if (input.category !== undefined) {
      patch.category = this.validateCategories([input.category])![0]!;
      hasPatch = true;
    }
    if (input.key !== undefined) {
      patch.key = this.normalizeRequiredText(input.key, MAX_KEY_LENGTH, "INVALID_MEMORY_KEY");
      hasPatch = true;
    }
    if (input.content !== undefined) {
      patch.content = this.normalizeRequiredText(input.content, MAX_CONTENT_LENGTH, "INVALID_MEMORY_CONTENT");
      hasPatch = true;
    }
    if (input.tags !== undefined) {
      patch.tags = this.normalizeTags(input.tags);
      hasPatch = true;
    }
    if (input.author !== undefined) {
      this.requireAuthor(input.author);
      patch.author = input.author;
      hasPatch = true;
    }
    if (!hasPatch) {
      throw new MemoryDomainError(
        "INVALID_MEMORY_PATCH",
        "At least one Memory field must be supplied.",
      );
    }

    const updated = await this.repository.updateMemory({
      userId: context.userId,
      id,
      ...patch,
    });
    if (!updated) {
      throw new MemoryDomainError("MEMORY_NOT_FOUND", "Memory was not found.");
    }
    return this.readMemoryDetail({ userId: context.userId, id });
  }

  async archiveMemory(input: {
    userId: string;
    id: string;
  }): Promise<void> {
    await this.requireActiveUser(input.userId);
    const archived = await this.repository.archiveMemory({
      ...input,
      ...WEB_USER_LIFECYCLE_CONTEXT,
    });

    if (!archived) {
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Memory was not found.",
      );
    }
  }

  async restoreMemory(input: {
    userId: string;
    id: string;
  }): Promise<void> {
    await this.requireActiveUser(input.userId);
    const id = input.id.trim();

    if (!id) {
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Memory was not found.",
      );
    }

    const restored = await this.repository.restoreMemory({
      userId: input.userId,
      id,
      ...WEB_USER_LIFECYCLE_CONTEXT,
    });

    if (!restored) {
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Memory was not found.",
      );
    }
  }

  async permanentlyDeleteMemory(input: {
    userId: string;
    id: string;
  }): Promise<void> {
    await this.requireActiveUser(input.userId);
    const id = input.id.trim();

    if (!id) {
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Memory was not found.",
      );
    }

    const permanentlyDelete = this.repository.permanentlyDeleteMemory;
    if (!permanentlyDelete) {
      throw new Error("Memory permanent delete persistence is unavailable.");
    }

    const deleted = await permanentlyDelete.call(this.repository, {
      userId: input.userId,
      id,
      ...WEB_USER_LIFECYCLE_CONTEXT,
    });

    if (!deleted) {
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Memory was not found.",
      );
    }
  }

  private async requireActiveUser(
    userId: string,
  ): Promise<MemoryUserRecord> {
    const user = await this.repository.findUserById(userId);

    if (!user) {
      throw new MemoryDomainError("USER_NOT_FOUND", "User was not found.");
    }

    if (user.status !== "active") {
      throw new MemoryDomainError("USER_DISABLED", "User is disabled.");
    }

    return user;
  }

  private requireAuthor(value: unknown): asserts value is ContentAuthor {
    if (!isContentAuthor(value)) {
      throw new MemoryDomainError(
        "AUTHOR_REQUIRED",
        "A content author must be selected.",
      );
    }
  }

  private validateCategories(
    categories?: readonly string[],
  ): MemoryCategory[] | undefined {
    if (!categories || categories.length === 0) {
      return undefined;
    }

    const allowedCategories = new Set<string>(ALLOWED_CATEGORIES);
    const normalized = [...new Set(categories)];

    const invalidCategory = normalized.find(
      (category) => !allowedCategories.has(category),
    );

    if (invalidCategory) {
      throw new MemoryDomainError(
        "INVALID_MEMORY_CATEGORY",
        `Unsupported memory category: ${invalidCategory}`,
      );
    }

    return normalized as MemoryCategory[];
  }

  private normalizeKeys(keys?: readonly string[]): string[] | undefined {
    if (!keys || keys.length === 0) {
      return undefined;
    }

    const normalized = [
      ...new Set(
        keys
          .map((key) => key.trim())
          .filter((key) => key.length > 0),
      ),
    ];

    return normalized.length > 0 ? normalized : undefined;
  }

  private normalizeQuery(query?: string): string | undefined {
    if (query === undefined) return undefined;
    const normalized = query.trim();
    if (!normalized) return undefined;
    if (normalized.length > MAX_SEARCH_LENGTH) {
      throw new MemoryDomainError(
        "INVALID_MEMORY_QUERY",
        "Memory search is too long.",
      );
    }
    return normalized;
  }

  private normalizeTagFilter(tag?: string): string | undefined {
    if (tag === undefined) return undefined;
    const normalized = tag.normalize("NFC").trim();
    if (!normalized) return undefined;
    if (normalized.length > MAX_TAG_LENGTH) {
      throw new MemoryDomainError(
        "INVALID_MEMORY_TAGS",
        `Memory tag filters may contain at most ${MAX_TAG_LENGTH} characters.`,
      );
    }
    return normalized;
  }

  private normalizeTags(tags: readonly string[]): string[] {
    if (!Array.isArray(tags)) {
      throw new MemoryDomainError(
        "INVALID_MEMORY_TAGS",
        "Memory tags must be an array.",
      );
    }

    const normalized = [
      ...new Set(
        tags.map((tag) => {
          const value = typeof tag === "string" ? tag.normalize("NFC").trim() : "";
          if (
            value.length === 0 ||
            value.length > MAX_TAG_LENGTH
          ) {
            throw new MemoryDomainError(
              "INVALID_MEMORY_TAGS",
              `Each memory tag must contain between 1 and ${MAX_TAG_LENGTH} characters.`,
            );
          }
          return value;
        }),
      ),
    ];

    if (normalized.length > MAX_TAGS) {
      throw new MemoryDomainError(
        "INVALID_MEMORY_TAGS",
        `Memories may contain at most ${MAX_TAGS} tags.`,
      );
    }

    return normalized;
  }

  private normalizeRequiredText(
    value: unknown,
    maxLength: number,
    code: "INVALID_MEMORY_KEY" | "INVALID_MEMORY_CONTENT",
  ): string {
    const normalized = typeof value === "string" ? value.normalize("NFC").trim() : "";
    if (normalized.length === 0 || normalized.length > maxLength) {
      throw new MemoryDomainError(code, "Memory text is invalid.");
    }
    return normalized;
  }

  private resolveLimit(limit?: number): number {
    if (limit === undefined) {
      return DEFAULT_MEMORY_LIMIT;
    }

    if (!Number.isInteger(limit) || limit < 1) {
      throw new MemoryDomainError(
        "INVALID_MEMORY_LIMIT",
        "Memory limit must be a positive integer.",
      );
    }

    return Math.min(limit, MAX_MEMORY_LIMIT);
  }

  private limitContent(content: string): string {
    if (content.length <= MAX_CONTENT_LENGTH) {
      return content;
    }

    return `${content.slice(0, MAX_CONTENT_LENGTH - 1)}…`;
  }

  private toDiscoveryItem(memory: MemoryDirectoryRecord): MemoryDiscoveryItem {
    return {
      id: memory.id,
      category: memory.category,
      key: memory.key,
      tags: memory.tags,
      author: memory.author ?? null,
      updated_at: memory.updatedAt.toISOString(),
      preview: createLeadingPreview(memory.contentPreview),
    };
  }
}
