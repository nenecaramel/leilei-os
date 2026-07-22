import type {
  MemoryCategory,
  MemoryRepository,
} from "./memory-repository.js";

const ALLOWED_CATEGORIES = [
  "profile",
  "preference",
  "goal",
  "project",
] as const satisfies readonly MemoryCategory[];

const DEFAULT_MEMORY_LIMIT = 50;
const MAX_MEMORY_LIMIT = 50;
const MAX_CONTENT_LENGTH = 4_000;

export type ReadMemoryInput = {
  userId: string;
  categories?: readonly string[];
  keys?: readonly string[];
  limit?: number;
};

export type ReadMemoryResult = {
  user: {
    display_name: string;
  };
  memories: Array<{
    category: MemoryCategory;
    key: string;
    content: string;
    updated_at: string;
  }>;
  metadata: {
    count: number;
  };
};

export type MemoryDomainErrorCode =
  | "INVALID_MEMORY_CATEGORY"
  | "INVALID_MEMORY_LIMIT"
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
    const user = await this.repository.findUserById(input.userId);

    if (!user) {
      throw new MemoryDomainError("USER_NOT_FOUND", "User was not found.");
    }

    if (user.status !== "active") {
      throw new MemoryDomainError("USER_DISABLED", "User is disabled.");
    }

    const categories = this.validateCategories(input.categories);
    const keys = this.normalizeKeys(input.keys);
    const limit = this.resolveLimit(input.limit);

    const memories = await this.repository.findActiveAssistantMemories({
      userId: input.userId,
      categories,
      keys,
      limit,
    });

    return {
      user: {
        display_name: user.displayName,
      },
      memories: memories.map((memory) => ({
        category: memory.category,
        key: memory.key,
        content: this.limitContent(memory.content),
        updated_at: memory.updatedAt.toISOString(),
      })),
      metadata: {
        count: memories.length,
      },
    };
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
      ...new Set(keys.map((key) => key.trim()).filter((key) => key.length > 0)),
    ];

    return normalized.length > 0 ? normalized : undefined;
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
}
