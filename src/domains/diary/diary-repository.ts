import {
  and,
  desc,
  eq,
  gte,
  ilike,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  diaryEntries,
  resourceLifecycleEvents,
  toolCalls,
  users,
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
import { requireActiveUserInTransaction } from "../require-active-user-transaction.js";
import type { ContentAuthor } from "../content-author.js";

export type DiaryUserRecord = {
  status: "active" | "disabled";
};

export type NormalizedDiaryCreate = {
  userId: string;
  title: string;
  content: string;
  date: string;
  tags: string[];
  mood: string | null;
  idempotencyKey: string;
  requestHash: string;
  mcpRequestHash: string;
  author: ContentAuthor;
};

export type DiaryAuditRequestSummary = {
  title_length: number;
  content_length: number;
  date: string;
  tag_count: number;
  has_mood: boolean;
};

export type DiaryRecord = {
  id: string;
  title: string;
  date: string;
  tags: string[];
  mood: string | null;
  createdAt: Date;
  requestHash: string;
  author?: ContentAuthor | null;
};

export type DiaryEntryRecord = {
  id: string;
  title: string;
  content: string;
  date: string;
  tags: string[];
  mood: string | null;
  createdAt: Date;
  updatedAt: Date;
  author?: ContentAuthor | null;
};

export type DiaryListQuery = {
  q?: string;
  tag?: string;
  mood?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type UpdateDiaryInput = {
  userId: string;
  id: string;
  title?: string;
  content?: string;
  date?: string;
  tags?: string[];
  mood?: string | null;
  author?: ContentAuthor;
};

export type DiaryLifecycleMutationInput = LifecycleMutationInput;

export type PersistDiaryResult =
  | { outcome: "created"; diary: DiaryRecord }
  | { outcome: "replayed"; diary: DiaryRecord }
  | { outcome: "conflict" };

export interface DiaryRepository {
  findUserById(userId: string): Promise<DiaryUserRecord | null>;

  findDiaryEntries(
    userId: string,
    limit: number,
    query?: DiaryListQuery,
  ): Promise<DiaryEntryRecord[]>;

  /** All active business dates with content, newest first. */
  listActiveContentDates(userId: string): Promise<string[]>;

  /** Every active entry for one exact business date (intentionally unbounded). */
  findActiveByDate(userId: string, date: string): Promise<DiaryEntryRecord[]>;

  countDiaryEntries(
    userId: string,
    query?: DiaryListQuery,
  ): Promise<number>;

  findDiaryById(
    userId: string,
    id: string,
  ): Promise<DiaryEntryRecord | null>;

  createDiaryWithAudit(
    diary: NormalizedDiaryCreate,
    requestSummary: DiaryAuditRequestSummary,
    options?: { mcpWriteIdempotency?: boolean },
  ): Promise<PersistDiaryResult>;

  updateDiary(
    input: UpdateDiaryInput,
  ): Promise<DiaryEntryRecord | null>;

  findArchivedDiaries(
    userId: string,
    limit: number,
  ): Promise<DiaryEntryRecord[]>;

  countArchivedDiaries(
    userId: string,
  ): Promise<number>;

  findArchivedDiaryById(
    userId: string,
    id: string,
  ): Promise<DiaryEntryRecord | null>;

  archiveDiary(input: DiaryLifecycleMutationInput): Promise<boolean>;

  restoreDiary(input: DiaryLifecycleMutationInput): Promise<boolean>;

  permanentlyDeleteDiary?(input: DiaryLifecycleMutationInput): Promise<boolean>;
}

function buildActiveDiaryConditions(
  userId: string,
  query: DiaryListQuery,
) {
  const conditions = [
    eq(diaryEntries.userId, userId),
    eq(diaryEntries.status, "active"),
  ];

  if (query.q) {
    const escaped = query.q.replace(/[\\%_]/g, "\\$&");
    const pattern = `%${escaped}%`;
    conditions.push(
      or(
        ilike(diaryEntries.title, pattern),
        ilike(diaryEntries.content, pattern),
      )!,
    );
  }
  if (query.tag) {
    conditions.push(
      sql`${query.tag}::text = any(${diaryEntries.tags})`,
    );
  }
  if (query.mood) {
    conditions.push(eq(diaryEntries.mood, query.mood));
  }
  if (query.dateFrom) {
    conditions.push(gte(diaryEntries.date, query.dateFrom));
  }
  if (query.dateTo) {
    conditions.push(lte(diaryEntries.date, query.dateTo));
  }

  return conditions;
}

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleDiaryRepository implements DiaryRepository {
  constructor(
    private readonly db: Database,
    private readonly lifecycleAudit: LifecycleAuditPersistence =
      new DrizzleLifecycleAuditPersistence(),
  ) {}

  async findUserById(
    userId: string,
  ): Promise<DiaryUserRecord | null> {
    const [user] = await this.db
      .select({
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user ?? null;
  }

  async findDiaryEntries(
    userId: string,
    limit: number,
    query: DiaryListQuery = {},
  ): Promise<DiaryEntryRecord[]> {
    const conditions = buildActiveDiaryConditions(userId, query);

    return this.db
      .select({
        id: diaryEntries.id,
        title: diaryEntries.title,
        content: diaryEntries.content,
        date: diaryEntries.date,
        tags: diaryEntries.tags,
        mood: diaryEntries.mood,
        author: diaryEntries.author,
        createdAt: diaryEntries.createdAt,
        updatedAt: diaryEntries.updatedAt,
      })
      .from(diaryEntries)
      .where(and(...conditions))
      .orderBy(
        desc(diaryEntries.date),
        desc(diaryEntries.createdAt),
      )
      .limit(limit);
  }

  async listActiveContentDates(userId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ date: diaryEntries.date })
      .from(diaryEntries)
      .where(
        and(
          eq(diaryEntries.userId, userId),
          eq(diaryEntries.status, "active"),
        ),
      )
      .orderBy(desc(diaryEntries.date));
    return rows.map((row) => row.date);
  }

  async findActiveByDate(
    userId: string,
    date: string,
  ): Promise<DiaryEntryRecord[]> {
    return this.db
      .select({
        id: diaryEntries.id,
        title: diaryEntries.title,
        content: diaryEntries.content,
        date: diaryEntries.date,
        tags: diaryEntries.tags,
        mood: diaryEntries.mood,
        author: diaryEntries.author,
        createdAt: diaryEntries.createdAt,
        updatedAt: diaryEntries.updatedAt,
      })
      .from(diaryEntries)
      .where(
        and(
          eq(diaryEntries.userId, userId),
          eq(diaryEntries.status, "active"),
          eq(diaryEntries.date, date),
        ),
      )
      .orderBy(desc(diaryEntries.createdAt), desc(diaryEntries.id));
  }

  async countDiaryEntries(
    userId: string,
    query: DiaryListQuery = {},
  ): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(diaryEntries)
      .where(and(...buildActiveDiaryConditions(userId, query)));

    return row?.count ?? 0;
  }

  async findDiaryById(
    userId: string,
    id: string,
  ): Promise<DiaryEntryRecord | null> {
    const [diary] = await this.db
      .select({
        id: diaryEntries.id,
        title: diaryEntries.title,
        content: diaryEntries.content,
        date: diaryEntries.date,
        tags: diaryEntries.tags,
        mood: diaryEntries.mood,
        author: diaryEntries.author,
        createdAt: diaryEntries.createdAt,
        updatedAt: diaryEntries.updatedAt,
      })
      .from(diaryEntries)
      .where(
        and(
          eq(diaryEntries.userId, userId),
          eq(diaryEntries.id, id),
          eq(diaryEntries.status, "active"),
        ),
      )
      .limit(1);

    return diary ?? null;
  }

  async createDiaryWithAudit(
    diary: NormalizedDiaryCreate,
    requestSummary: DiaryAuditRequestSummary,
    options: { mcpWriteIdempotency?: boolean } = {},
  ): Promise<PersistDiaryResult> {
    const startedAt = performance.now();

    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, diary.userId);
      const idempotency = options.mcpWriteIdempotency
        ? await lockAndReadMcpIdempotency(transaction, {
            userId: diary.userId,
            toolName: "write_diary",
            idempotencyKey: diary.idempotencyKey,
          })
        : null;

      if (idempotency) {
        if (
          idempotency.requestHash !== diary.mcpRequestHash ||
          idempotency.resourceType !== "diary_entry"
        ) {
          return { outcome: "conflict" };
        }

        const [existing] = await transaction
          .select({
            id: diaryEntries.id,
            title: diaryEntries.title,
            date: diaryEntries.date,
            tags: diaryEntries.tags,
            mood: diaryEntries.mood,
            author: diaryEntries.author,
            createdAt: diaryEntries.createdAt,
            requestHash: diaryEntries.requestHash,
          })
          .from(diaryEntries)
          .where(
            and(
              eq(diaryEntries.userId, diary.userId),
              eq(diaryEntries.id, idempotency.resourceId),
            ),
          )
          .limit(1);

        if (!existing) {
          throw new Error("Idempotent diary record was not found.");
        }
        return { outcome: "replayed", diary: existing };
      }

      const [inserted] = await transaction
        .insert(diaryEntries)
        .values({
          userId: diary.userId,
          title: diary.title,
          content: diary.content,
          date: diary.date,
          tags: diary.tags,
          mood: diary.mood,
          author: diary.author,
          source: "chatgpt_mcp",
          status: "active",
          idempotencyKey: diary.idempotencyKey,
          requestHash: diary.requestHash,
        })
        .onConflictDoNothing({
          target: [
            diaryEntries.userId,
            diaryEntries.idempotencyKey,
          ],
        })
        .returning({
          id: diaryEntries.id,
          title: diaryEntries.title,
          date: diaryEntries.date,
          tags: diaryEntries.tags,
          mood: diaryEntries.mood,
          author: diaryEntries.author,
          createdAt: diaryEntries.createdAt,
          requestHash: diaryEntries.requestHash,
        });

      if (inserted) {
        if (options.mcpWriteIdempotency) {
          await recordMcpIdempotency(transaction, {
            userId: diary.userId,
            toolName: "write_diary",
            idempotencyKey: diary.idempotencyKey,
            requestHash: diary.mcpRequestHash,
            resourceType: "diary_entry",
            resourceId: inserted.id,
          });
        }
        await this.insertAudit(transaction, {
          diary,
          requestSummary,
          resourceId: inserted.id,
          status: "success",
          resultSummary: {
            created: true,
            idempotent_replay: false,
          },
          durationMs: this.elapsedMilliseconds(startedAt),
        });

        return {
          outcome: "created",
          diary: inserted,
        };
      }

      const [existing] = await transaction
        .select({
          id: diaryEntries.id,
          title: diaryEntries.title,
          date: diaryEntries.date,
          tags: diaryEntries.tags,
          mood: diaryEntries.mood,
          author: diaryEntries.author,
          createdAt: diaryEntries.createdAt,
          requestHash: diaryEntries.requestHash,
        })
        .from(diaryEntries)
        .where(
          and(
            eq(diaryEntries.userId, diary.userId),
            eq(
              diaryEntries.idempotencyKey,
              diary.idempotencyKey,
            ),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new Error(
          "Idempotent diary record was not found after conflict.",
        );
      }

      if (existing.requestHash !== diary.requestHash) {
        if (!options.mcpWriteIdempotency) {
          await this.insertAudit(transaction, {
            diary,
            requestSummary,
            resourceId: null,
            status: "rejected",
            errorCode: "IDEMPOTENCY_CONFLICT",
            resultSummary: {
              created: false,
              idempotent_replay: false,
            },
            durationMs: this.elapsedMilliseconds(startedAt),
          });
        }
        return {
          outcome: "conflict",
        };
      }

      if (
        options.mcpWriteIdempotency &&
        (existing.author === null || existing.author === undefined || existing.author !== diary.author)
      ) {
        return { outcome: "conflict" };
      }

      if (options.mcpWriteIdempotency) {
        await recordMcpIdempotency(transaction, {
          userId: diary.userId,
          toolName: "write_diary",
          idempotencyKey: diary.idempotencyKey,
          requestHash: diary.mcpRequestHash,
          resourceType: "diary_entry",
          resourceId: existing.id,
        });
      } else {
        await this.insertAudit(transaction, {
          diary,
          requestSummary,
          resourceId: existing.id,
          status: "success",
          resultSummary: {
            created: false,
            idempotent_replay: true,
          },
          durationMs: this.elapsedMilliseconds(startedAt),
        });
      }

      return {
        outcome: "replayed",
        diary: existing,
      };
    });
  }

  async updateDiary(
    input: UpdateDiaryInput,
  ): Promise<DiaryEntryRecord | null> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const [updated] = await transaction
        .update(diaryEntries)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.content === undefined ? {} : { content: input.content }),
          ...(input.date === undefined ? {} : { date: input.date }),
          ...(input.tags === undefined ? {} : { tags: input.tags }),
          ...(input.mood === undefined ? {} : { mood: input.mood }),
          ...(input.author === undefined ? {} : { author: input.author }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(diaryEntries.userId, input.userId),
            eq(diaryEntries.id, input.id),
            eq(diaryEntries.status, "active"),
          ),
        )
        .returning({
          id: diaryEntries.id,
          title: diaryEntries.title,
          content: diaryEntries.content,
          date: diaryEntries.date,
          tags: diaryEntries.tags,
          mood: diaryEntries.mood,
          author: diaryEntries.author,
          createdAt: diaryEntries.createdAt,
          updatedAt: diaryEntries.updatedAt,
        });

      return updated ?? null;
    });
  }

  async findArchivedDiaries(
    userId: string,
    limit: number,
  ): Promise<DiaryEntryRecord[]> {
    return this.db
      .select({
        id: diaryEntries.id,
        title: diaryEntries.title,
        content: diaryEntries.content,
        date: diaryEntries.date,
        tags: diaryEntries.tags,
        mood: diaryEntries.mood,
        author: diaryEntries.author,
        createdAt: diaryEntries.createdAt,
        updatedAt: diaryEntries.updatedAt,
      })
      .from(diaryEntries)
      .where(
        and(
          eq(diaryEntries.userId, userId),
          eq(diaryEntries.status, "archived"),
        ),
      )
      .orderBy(
        desc(diaryEntries.date),
        desc(diaryEntries.createdAt),
      )
      .limit(limit);
  }

  async countArchivedDiaries(
    userId: string,
  ): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(diaryEntries)
      .where(
        and(
          eq(diaryEntries.userId, userId),
          eq(diaryEntries.status, "archived"),
        ),
      );

    return row?.count ?? 0;
  }

  async findArchivedDiaryById(
    userId: string,
    id: string,
  ): Promise<DiaryEntryRecord | null> {
    const [diary] = await this.db
      .select({
        id: diaryEntries.id,
        title: diaryEntries.title,
        content: diaryEntries.content,
        date: diaryEntries.date,
        tags: diaryEntries.tags,
        mood: diaryEntries.mood,
        author: diaryEntries.author,
        createdAt: diaryEntries.createdAt,
        updatedAt: diaryEntries.updatedAt,
      })
      .from(diaryEntries)
      .where(
        and(
          eq(diaryEntries.userId, userId),
          eq(diaryEntries.id, id),
          eq(diaryEntries.status, "archived"),
        ),
      )
      .limit(1);

    return diary ?? null;
  }

  async archiveDiary(
    input: DiaryLifecycleMutationInput,
  ): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const archived = await transaction
        .update(diaryEntries)
        .set({
          status: "archived",
        })
        .where(
          and(
            eq(diaryEntries.id, input.id),
            eq(diaryEntries.userId, input.userId),
            eq(diaryEntries.status, "active"),
          ),
        )
        .returning({ id: diaryEntries.id });

      if (archived.length !== 1) return false;

      await this.lifecycleAudit.record(transaction, createLifecycleAuditEvent({
        userId: input.userId,
        resourceType: "diary",
        resourceId: archived[0]!.id,
        action: "archive",
        actorType: input.actorType,
        channel: input.channel,
      }));
      return true;
    });
  }

  async restoreDiary(
    input: DiaryLifecycleMutationInput,
  ): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const restored = await transaction
        .update(diaryEntries)
        .set({
          status: "active",
        })
        .where(
          and(
            eq(diaryEntries.id, input.id),
            eq(diaryEntries.userId, input.userId),
            eq(diaryEntries.status, "archived"),
          ),
        )
        .returning({ id: diaryEntries.id });

      if (restored.length !== 1) return false;

      await this.lifecycleAudit.record(transaction, createLifecycleAuditEvent({
        userId: input.userId,
        resourceType: "diary",
        resourceId: restored[0]!.id,
        action: "restore",
        actorType: input.actorType,
        channel: input.channel,
      }));
      return true;
    });
  }

  async permanentlyDeleteDiary(
    input: DiaryLifecycleMutationInput,
  ): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);

      const eligible = await transaction
        .select({ id: diaryEntries.id })
        .from(diaryEntries)
        .where(
          and(
            eq(diaryEntries.id, input.id),
            eq(diaryEntries.userId, input.userId),
            eq(diaryEntries.status, "archived"),
          ),
        )
        .limit(1);
      if (eligible.length !== 1) return false;

      await transaction
        .delete(toolCalls)
        .where(
          and(
            eq(toolCalls.userId, input.userId),
            eq(toolCalls.resourceType, "diary_entry"),
            eq(toolCalls.resourceId, input.id),
          ),
        );
      await transaction
        .delete(resourceLifecycleEvents)
        .where(
          and(
            eq(resourceLifecycleEvents.userId, input.userId),
            eq(resourceLifecycleEvents.resourceType, "diary"),
            eq(resourceLifecycleEvents.resourceId, input.id),
          ),
        );

      const deleted = await transaction
        .delete(diaryEntries)
        .where(
          and(
            eq(diaryEntries.id, input.id),
            eq(diaryEntries.userId, input.userId),
            eq(diaryEntries.status, "archived"),
          ),
        )
        .returning({ id: diaryEntries.id });
      if (deleted.length !== 1) {
        throw new Error("Diary permanent delete affected an unexpected number of rows.");
      }

      const remaining = await transaction
        .select({ id: diaryEntries.id })
        .from(diaryEntries)
        .where(
          and(
            eq(diaryEntries.id, input.id),
            eq(diaryEntries.userId, input.userId),
          ),
        )
        .limit(1);
      if (remaining.length !== 0) {
        throw new Error("Diary permanent delete did not remove the entry.");
      }

      await this.lifecycleAudit.record(
        transaction,
        createLifecycleAuditEvent({
          userId: input.userId,
          resourceType: "diary",
          resourceId: input.id,
          action: "permanent_delete",
          actorType: input.actorType,
          channel: input.channel,
        }),
      );
      return true;
    });
  }

  private async insertAudit(
    transaction: Parameters<
      Parameters<Database["transaction"]>[0]
    >[0],
    input: {
      diary: NormalizedDiaryCreate;
      requestSummary: DiaryAuditRequestSummary;
      resourceId: string | null;
      status: "success" | "rejected" | "error";
      errorCode?: string;
      resultSummary: Record<string, unknown>;
      durationMs: number;
    },
  ): Promise<void> {
    await transaction.insert(toolCalls).values({
      userId: input.diary.userId,
      toolName: "write_diary",
      operation: "create",
      resourceType: "diary_entry",
      resourceId: input.resourceId,
      idempotencyKey: input.diary.idempotencyKey,
      requestSummary: input.requestSummary,
      resultSummary: input.resultSummary,
      durationMs: input.durationMs,
      status: input.status,
      errorCode: input.errorCode,
    });
  }

  private elapsedMilliseconds(startedAt: number): number {
    return Math.max(
      0,
      Math.round(performance.now() - startedAt),
    );
  }
}
