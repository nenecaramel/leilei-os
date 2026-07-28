import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  coreMemories,
  users,
  type memoryCategoryEnum,
} from "../../database/schema.js";

export type MemoryCategory = (typeof memoryCategoryEnum.enumValues)[number];

export type MemoryUserRecord = {
  displayName: string;
  status: "active" | "disabled";
};

export type ActiveAssistantMemoryRecord = {
  id: string;
  category: MemoryCategory;
  key: string;
  content: string;
  updatedAt: Date;
};

export type FindMemoriesInput = {
  userId: string;
  query?: string;
  categories?: readonly MemoryCategory[];
  keys?: readonly string[];
  limit: number;
};

export type CreateMemoryInput = {
  userId: string;
  category: MemoryCategory;
  key: string;
  content: string;
  source: string;
};

export type UpdateMemoryInput = {
  id: string;
  userId: string;
  content: string;
};

export interface MemoryRepository {
  findUserById(userId: string): Promise<MemoryUserRecord | null>;

  findActiveAssistantMemories(
    input: FindMemoriesInput,
  ): Promise<ActiveAssistantMemoryRecord[]>;

  findActiveAssistantMemoryCategories(
    userId: string,
  ): Promise<MemoryCategory[]>;

  findActiveAssistantMemoryById(input: {
    userId: string;
    id: string;
  }): Promise<ActiveAssistantMemoryRecord | null>;

  createMemory(input: CreateMemoryInput): Promise<void>;

  updateMemory(input: UpdateMemoryInput): Promise<void>;

  archiveMemory(input: {
    id: string;
    userId: string;
  }): Promise<void>;
}

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleMemoryRepository implements MemoryRepository {
  constructor(private readonly db: Database) {}

  async findUserById(userId: string): Promise<MemoryUserRecord | null> {
    const [user] = await this.db
      .select({
        displayName: users.displayName,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user ?? null;
  }

  async findActiveAssistantMemories(
    input: FindMemoriesInput,
  ): Promise<ActiveAssistantMemoryRecord[]> {
    const queryFilter = input.query
      ? (() => {
          const escaped = input.query.replace(/[\\%_]/g, "\\$&");
          const pattern = `%${escaped}%`;
          return or(
            ilike(coreMemories.key, pattern),
            ilike(
              sql<string>`replace(${coreMemories.key}, '_', ' ')`,
              pattern,
            ),
            ilike(coreMemories.content, pattern),
            ilike(
              sql<string>`${coreMemories.category}::text`,
              pattern,
            ),
          );
        })()
      : undefined;

    const categoryFilter =
      input.categories && input.categories.length > 0
        ? inArray(coreMemories.category, [...input.categories])
        : undefined;

    const keyFilter =
      input.keys && input.keys.length > 0
        ? inArray(coreMemories.key, [...input.keys])
        : undefined;

    return this.db
      .select({
        id: coreMemories.id,
        category: coreMemories.category,
        key: coreMemories.key,
        content: coreMemories.content,
        updatedAt: coreMemories.updatedAt,
      })
      .from(coreMemories)
      .where(
        and(
          eq(coreMemories.userId, input.userId),
          eq(coreMemories.status, "active"),
          eq(coreMemories.visibility, "assistant"),
          queryFilter,
          categoryFilter,
          keyFilter,
        ),
      )
      .orderBy(
        asc(coreMemories.sortOrder),
        asc(coreMemories.category),
        asc(coreMemories.key),
        asc(coreMemories.id),
      )
      .limit(input.limit);
  }

  async findActiveAssistantMemoryCategories(
    userId: string,
  ): Promise<MemoryCategory[]> {
    const rows = await this.db
      .selectDistinct({
        category: coreMemories.category,
      })
      .from(coreMemories)
      .where(
        and(
          eq(coreMemories.userId, userId),
          eq(coreMemories.status, "active"),
          eq(coreMemories.visibility, "assistant"),
        ),
      )
      .orderBy(asc(coreMemories.category));

    return rows.map(({ category }) => category);
  }

  async findActiveAssistantMemoryById(input: {
    userId: string;
    id: string;
  }): Promise<ActiveAssistantMemoryRecord | null> {
    const [memory] = await this.db
      .select({
        id: coreMemories.id,
        category: coreMemories.category,
        key: coreMemories.key,
        content: coreMemories.content,
        updatedAt: coreMemories.updatedAt,
      })
      .from(coreMemories)
      .where(
        and(
          eq(coreMemories.id, input.id),
          eq(coreMemories.userId, input.userId),
          eq(coreMemories.status, "active"),
          eq(coreMemories.visibility, "assistant"),
        ),
      )
      .limit(1);

    return memory ?? null;
  }

  async createMemory(input: CreateMemoryInput): Promise<void> {
    await this.db.insert(coreMemories).values({
      userId: input.userId,
      category: input.category,
      key: input.key,
      content: input.content,
      source: input.source,
      visibility: "assistant",
      status: "active",
    });
  }

  async updateMemory(input: UpdateMemoryInput): Promise<void> {
    await this.db
      .update(coreMemories)
      .set({
        content: input.content,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(coreMemories.id, input.id),
          eq(coreMemories.userId, input.userId),
        ),
      );
  }

  async archiveMemory(input: {
    id: string;
    userId: string;
  }): Promise<void> {
    await this.db
      .update(coreMemories)
      .set({
        status: "archived",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(coreMemories.id, input.id),
          eq(coreMemories.userId, input.userId),
        ),
      );
  }
}
