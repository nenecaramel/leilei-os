import { and, eq } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { diaryEntries, toolCalls, users } from "../../database/schema.js";

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
};

export type PersistDiaryResult =
  | { outcome: "created"; diary: DiaryRecord }
  | { outcome: "replayed"; diary: DiaryRecord }
  | { outcome: "conflict" };

export interface DiaryRepository {
  findUserById(userId: string): Promise<DiaryUserRecord | null>;
  createDiaryWithAudit(
    diary: NormalizedDiaryCreate,
    requestSummary: DiaryAuditRequestSummary,
  ): Promise<PersistDiaryResult>;
}

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleDiaryRepository implements DiaryRepository {
  constructor(private readonly db: Database) {}

  async findUserById(userId: string): Promise<DiaryUserRecord | null> {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user ?? null;
  }

  async createDiaryWithAudit(
    diary: NormalizedDiaryCreate,
    requestSummary: DiaryAuditRequestSummary,
  ): Promise<PersistDiaryResult> {
    const startedAt = performance.now();

    return this.db.transaction(async (transaction) => {
      const [inserted] = await transaction
        .insert(diaryEntries)
        .values({
          userId: diary.userId,
          title: diary.title,
          content: diary.content,
          date: diary.date,
          tags: diary.tags,
          mood: diary.mood,
          source: "chatgpt_mcp",
          idempotencyKey: diary.idempotencyKey,
          requestHash: diary.requestHash,
        })
        .onConflictDoNothing({
          target: [diaryEntries.userId, diaryEntries.idempotencyKey],
        })
        .returning({
          id: diaryEntries.id,
          title: diaryEntries.title,
          date: diaryEntries.date,
          tags: diaryEntries.tags,
          mood: diaryEntries.mood,
          createdAt: diaryEntries.createdAt,
          requestHash: diaryEntries.requestHash,
        });

      if (inserted) {
        await this.insertAudit(transaction, {
          diary,
          requestSummary,
          resourceId: inserted.id,
          status: "success",
          resultSummary: { created: true, idempotent_replay: false },
          durationMs: this.elapsedMilliseconds(startedAt),
        });

        return { outcome: "created", diary: inserted };
      }

      const [existing] = await transaction
        .select({
          id: diaryEntries.id,
          title: diaryEntries.title,
          date: diaryEntries.date,
          tags: diaryEntries.tags,
          mood: diaryEntries.mood,
          createdAt: diaryEntries.createdAt,
          requestHash: diaryEntries.requestHash,
        })
        .from(diaryEntries)
        .where(
          and(
            eq(diaryEntries.userId, diary.userId),
            eq(diaryEntries.idempotencyKey, diary.idempotencyKey),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new Error("Idempotent diary record was not found after conflict.");
      }

      if (existing.requestHash !== diary.requestHash) {
        await this.insertAudit(transaction, {
          diary,
          requestSummary,
          resourceId: null,
          status: "rejected",
          errorCode: "IDEMPOTENCY_CONFLICT",
          resultSummary: { created: false, idempotent_replay: false },
          durationMs: this.elapsedMilliseconds(startedAt),
        });

        return { outcome: "conflict" };
      }

      await this.insertAudit(transaction, {
        diary,
        requestSummary,
        resourceId: existing.id,
        status: "success",
        resultSummary: { created: false, idempotent_replay: true },
        durationMs: this.elapsedMilliseconds(startedAt),
      });

      return { outcome: "replayed", diary: existing };
    });
  }

  private async insertAudit(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
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
    return Math.max(0, Math.round(performance.now() - startedAt));
  }
}
