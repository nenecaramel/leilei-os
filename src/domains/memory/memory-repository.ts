import {
  and,
  asc,
  desc,
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
import {
  createLifecycleAuditEvent,
  DrizzleLifecycleAuditPersistence,
  type LifecycleAuditPersistence,
  type LifecycleMutationInput,
} from "../lifecycle/lifecycle-audit-repository.js";
import {
  lockAndReadMcpIdempotency,
  recordMcpIdempotency,
} from "../mcp-write/mcp-write-idempotency.js";

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
  tags: string[];
  source: string;
  updatedAt: Date;
};

export type TrustedMemorySource =
  | "web"
  | "mcp"
  | "phase_2_validation";

export type McpMemoryRecord = ActiveAssistantMemoryRecord & {
  source: "mcp";
  status: "active" | "archived";
  createdAt: Date;
};

export type McpMemoryCreateResult =
  | { outcome: "created" | "replayed"; memory: McpMemoryRecord }
  | { outcome: "conflict" | "key_conflict" };

export type MemoryOrdering = "default" | "updated_desc";

export type FindMemoriesInput = {
  userId: string;
  query?: string;
  categories?: readonly MemoryCategory[];
  keys?: readonly string[];
  tag?: string;
  ordering?: MemoryOrdering;
  limit: number;
};

export type FindArchivedMemoriesInput = {
  userId: string;
  limit: number;
};

export type CreateMemoryInput = {
  userId: string;
  category: MemoryCategory;
  key: string;
  content: string;
  tags: string[];
  source: TrustedMemorySource;
};

export type UpdateMemoryInput = {
  id: string;
  userId: string;
  content: string;
  tags?: string[];
};

export type MemoryLifecycleMutationInput = LifecycleMutationInput;

export interface MemoryRepository {
  findUserById(userId: string): Promise<MemoryUserRecord | null>;

  findActiveAssistantMemories(
    input: FindMemoriesInput,
  ): Promise<ActiveAssistantMemoryRecord[]>;

  findActiveAssistantMemoryCategories(
    userId: string,
  ): Promise<MemoryCategory[]>;

  findActiveAssistantMemoryTags(userId: string): Promise<string[]>;

  findActiveAssistantMemoryById(input: {
    userId: string;
    id: string;
  }): Promise<ActiveAssistantMemoryRecord | null>;

  findArchivedAssistantMemories(
    input: FindArchivedMemoriesInput,
  ): Promise<ActiveAssistantMemoryRecord[]>;

  findArchivedAssistantMemoryById(input: {
    userId: string;
    id: string;
  }): Promise<ActiveAssistantMemoryRecord | null>;

  createMemory(input: CreateMemoryInput): Promise<void>;

  createMemoryIdempotently?(input: CreateMemoryInput & {
    source: "mcp";
    idempotencyKey: string;
    requestHash: string;
  }): Promise<McpMemoryCreateResult>;

  updateMemory(input: UpdateMemoryInput): Promise<boolean>;

  archiveMemory(input: MemoryLifecycleMutationInput): Promise<boolean>;

  restoreMemory(input: MemoryLifecycleMutationInput): Promise<boolean>;
}

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleMemoryRepository implements MemoryRepository {
  constructor(
    private readonly db: Database,
    private readonly lifecycleAudit: LifecycleAuditPersistence =
      new DrizzleLifecycleAuditPersistence(),
  ) {}

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
    const tagFilter = input.tag
      ? sql`${input.tag}::varchar(50) = any(${coreMemories.tags})`
      : undefined;
    const ordering =
      input.ordering === "updated_desc"
        ? [
            desc(coreMemories.updatedAt),
            desc(coreMemories.id),
          ]
        : [
            asc(coreMemories.sortOrder),
            asc(coreMemories.category),
            asc(coreMemories.key),
            asc(coreMemories.id),
          ];

    return this.db
      .select({
        id: coreMemories.id,
        category: coreMemories.category,
        key: coreMemories.key,
        content: coreMemories.content,
        tags: coreMemories.tags,
        source: coreMemories.source,
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
          tagFilter,
        ),
      )
      .orderBy(...ordering)
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

  async findActiveAssistantMemoryTags(
    userId: string,
  ): Promise<string[]> {
    const tag = sql<string>`unnest(${coreMemories.tags})`;
    const rows = await this.db
      .selectDistinct({ tag })
      .from(coreMemories)
      .where(
        and(
          eq(coreMemories.userId, userId),
          eq(coreMemories.status, "active"),
          eq(coreMemories.visibility, "assistant"),
        ),
      )
      .orderBy(asc(tag));

    return rows.map((row) => row.tag);
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
        tags: coreMemories.tags,
        source: coreMemories.source,
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

  async findArchivedAssistantMemories(
    input: FindArchivedMemoriesInput,
  ): Promise<ActiveAssistantMemoryRecord[]> {
    return this.db
      .select({
        id: coreMemories.id,
        category: coreMemories.category,
        key: coreMemories.key,
        content: coreMemories.content,
        tags: coreMemories.tags,
        source: coreMemories.source,
        updatedAt: coreMemories.updatedAt,
      })
      .from(coreMemories)
      .where(
        and(
          eq(coreMemories.userId, input.userId),
          eq(coreMemories.status, "archived"),
          eq(coreMemories.visibility, "assistant"),
        ),
      )
      .orderBy(
        desc(coreMemories.updatedAt),
        desc(coreMemories.id),
      )
      .limit(input.limit);
  }

  async findArchivedAssistantMemoryById(input: {
    userId: string;
    id: string;
  }): Promise<ActiveAssistantMemoryRecord | null> {
    const [memory] = await this.db
      .select({
        id: coreMemories.id,
        category: coreMemories.category,
        key: coreMemories.key,
        content: coreMemories.content,
        tags: coreMemories.tags,
        source: coreMemories.source,
        updatedAt: coreMemories.updatedAt,
      })
      .from(coreMemories)
      .where(
        and(
          eq(coreMemories.id, input.id),
          eq(coreMemories.userId, input.userId),
          eq(coreMemories.status, "archived"),
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
      tags: input.tags,
      source: input.source,
      visibility: "assistant",
      status: "active",
    });
  }

  async createMemoryIdempotently(input: CreateMemoryInput & {
    source: "mcp";
    idempotencyKey: string;
    requestHash: string;
  }): Promise<McpMemoryCreateResult> {
    return this.db.transaction(async (transaction) => {
      const idempotency = await lockAndReadMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "write_memory",
        idempotencyKey: input.idempotencyKey,
      });

      if (idempotency) {
        if (
          idempotency.requestHash !== input.requestHash ||
          idempotency.resourceType !== "memory"
        ) {
          return { outcome: "conflict" };
        }

        const existing = await this.findMcpMemoryById(
          transaction,
          input.userId,
          idempotency.resourceId,
        );
        if (!existing) {
          throw new Error("Idempotent Memory record was not found.");
        }
        return { outcome: "replayed", memory: existing };
      }

      const [inserted] = await transaction
        .insert(coreMemories)
        .values({
          userId: input.userId,
          category: input.category,
          key: input.key,
          content: input.content,
          tags: input.tags,
          source: "mcp",
          visibility: "assistant",
          status: "active",
        })
        .onConflictDoNothing({
          target: [coreMemories.userId, coreMemories.key],
        })
        .returning({
          id: coreMemories.id,
          category: coreMemories.category,
          key: coreMemories.key,
          content: coreMemories.content,
          tags: coreMemories.tags,
          source: coreMemories.source,
          status: coreMemories.status,
          createdAt: coreMemories.createdAt,
          updatedAt: coreMemories.updatedAt,
        });

      if (!inserted) return { outcome: "key_conflict" };
      if (inserted.source !== "mcp") {
        throw new Error("MCP Memory source was not preserved.");
      }

      await recordMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "write_memory",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        resourceType: "memory",
        resourceId: inserted.id,
      });

      return { outcome: "created", memory: inserted as McpMemoryRecord };
    });
  }

  private async findMcpMemoryById(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    userId: string,
    id: string,
  ): Promise<McpMemoryRecord | null> {
    const [memory] = await transaction
      .select({
        id: coreMemories.id,
        category: coreMemories.category,
        key: coreMemories.key,
        content: coreMemories.content,
        tags: coreMemories.tags,
        source: coreMemories.source,
        status: coreMemories.status,
        createdAt: coreMemories.createdAt,
        updatedAt: coreMemories.updatedAt,
      })
      .from(coreMemories)
      .where(and(eq(coreMemories.userId, userId), eq(coreMemories.id, id)))
      .limit(1);

    if (!memory || memory.source !== "mcp") return null;
    return memory as McpMemoryRecord;
  }

  async updateMemory(input: UpdateMemoryInput): Promise<boolean> {
    const updated = await this.db
      .update(coreMemories)
      .set({
        content: input.content,
        ...(input.tags ? { tags: input.tags } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(coreMemories.id, input.id),
          eq(coreMemories.userId, input.userId),
          eq(coreMemories.status, "active"),
          eq(coreMemories.visibility, "assistant"),
        ),
      )
      .returning({ id: coreMemories.id });

    return updated.length === 1;
  }

  async archiveMemory(
    input: MemoryLifecycleMutationInput,
  ): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      const archived = await transaction
        .update(coreMemories)
        .set({
          status: "archived",
        })
        .where(
          and(
            eq(coreMemories.id, input.id),
            eq(coreMemories.userId, input.userId),
            eq(coreMemories.status, "active"),
            eq(coreMemories.visibility, "assistant"),
          ),
        )
        .returning({ id: coreMemories.id });

      if (archived.length !== 1) return false;

      await this.lifecycleAudit.record(transaction, createLifecycleAuditEvent({
        userId: input.userId,
        resourceType: "memory",
        resourceId: archived[0]!.id,
        action: "archive",
        actorType: input.actorType,
        channel: input.channel,
      }));
      return true;
    });
  }

  async restoreMemory(
    input: MemoryLifecycleMutationInput,
  ): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      const restored = await transaction
        .update(coreMemories)
        .set({
          status: "active",
        })
        .where(
          and(
            eq(coreMemories.id, input.id),
            eq(coreMemories.userId, input.userId),
            eq(coreMemories.status, "archived"),
            eq(coreMemories.visibility, "assistant"),
          ),
        )
        .returning({ id: coreMemories.id });

      if (restored.length !== 1) return false;

      await this.lifecycleAudit.record(transaction, createLifecycleAuditEvent({
        userId: input.userId,
        resourceType: "memory",
        resourceId: restored[0]!.id,
        action: "restore",
        actorType: input.actorType,
        channel: input.channel,
      }));
      return true;
    });
  }
}
