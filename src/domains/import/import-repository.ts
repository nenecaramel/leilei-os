import { asc, eq, inArray } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  dataImportRuns,
  diaryEntries,
  todoEntries,
  todoPapers,
  users,
} from "../../database/schema.js";
import type {
  ExportDiaryRecord,
  ExportTodoPaper,
} from "../export/export-types.js";
import { hashCanonical } from "./import-canonical.js";
import type { ImportCurrentState, ImportModule } from "./import-planner.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction =
  Parameters<Database["transaction"]>[0] extends
    (tx: infer T) => unknown
    ? T
    : never;
type DbExecutor = Database | Transaction;

export type ImportAuditRun = {
  package_sha256: string;
  preview_fingerprint: string;
  schema_version: number;
  summary: Record<string, unknown>;
};

export interface ImportRepository {
  findUserById(
    userId: string,
  ): Promise<{ status: "active" | "disabled" } | null>;

  withTransaction<T>(
    work: (repository: ImportRepository) => Promise<T>,
  ): Promise<T>;

  readCurrentState(
    userId: string,
  ): Promise<ImportCurrentState>;

  insertDiary(
    userId: string,
    record: ExportDiaryRecord,
  ): Promise<void>;

  insertTodo(
    userId: string,
    record: ExportTodoPaper,
  ): Promise<void>;

  rereadCreatedState(
    userId: string,
    modules: Set<ImportModule>,
  ): Promise<ImportCurrentState>;

  recordAuditRun(
    userId: string,
    run: ImportAuditRun,
  ): Promise<void>;
}

const toIso = (value: Date): string =>
  value.toISOString();

export class DrizzleImportRepository
implements ImportRepository {
  constructor(private readonly db: DbExecutor) {}

  async findUserById(
    userId: string,
  ): Promise<{ status: "active" | "disabled" } | null> {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user ?? null;
  }

  async withTransaction<T>(
    work: (repository: ImportRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(
      async (tx) =>
        work(
          new DrizzleImportRepository(
            tx as Transaction,
          ),
        ),
      { isolationLevel: "serializable" },
    );
  }

  async readCurrentState(
    userId: string,
  ): Promise<ImportCurrentState> {
    const [diary, papers, allDiary] =
      await Promise.all([
        this.db
          .select()
          .from(diaryEntries)
          .where(eq(diaryEntries.userId, userId))
          .orderBy(asc(diaryEntries.id)),
        this.db
          .select()
          .from(todoPapers)
          .where(eq(todoPapers.userId, userId))
          .orderBy(
            asc(todoPapers.businessDate),
            asc(todoPapers.author),
          ),
        this.db
          .select({ id: diaryEntries.id })
          .from(diaryEntries),
      ]);

    const entries =
      papers.length === 0
        ? []
        : await this.db
            .select({
              paperId: todoEntries.paperId,
              id: todoEntries.entryId,
              kind: todoEntries.kind,
              text: todoEntries.text,
            })
            .from(todoEntries)
            .where(
              inArray(
                todoEntries.paperId,
                papers.map((paper) => paper.id),
              ),
            )
            .orderBy(
              asc(todoEntries.paperId),
              asc(todoEntries.position),
            );

    const grouped = new Map<
      string,
      Array<{
        id: string;
        kind: "pending" | "completed" | "record";
        text: string;
      }>
    >();

    for (const entry of entries) {
      const list = grouped.get(entry.paperId) ?? [];
      list.push({
        id: entry.id,
        kind: entry.kind,
        text: entry.text,
      });
      grouped.set(entry.paperId, list);
    }

    return {
      diary: diary.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        date: row.date,
        tags: row.tags,
        mood: row.mood,
        source: row.source,
        author: row.author,
        status: row.status,
        created_at: toIso(row.createdAt),
        updated_at: toIso(row.updatedAt),
      })),
      todo: papers.map((row) => ({
        date: row.businessDate,
        author: row.author,
        revision: row.revision,
        created_at: toIso(row.createdAt),
        updated_at: toIso(row.updatedAt),
        entries: grouped.get(row.id) ?? [],
      })),
      foreign_diary_ids: new Set(
        allDiary.map((row) => row.id),
      ),
    };
  }

  async insertDiary(
    userId: string,
    record: ExportDiaryRecord,
  ): Promise<void> {
    const values = {
      id: record.id,
      userId,
      title: record.title,
      content: record.content,
      date: record.date,
      tags: record.tags,
      mood: record.mood,
      source: record.source as "chatgpt_mcp",
      author: record.author,
      status: record.status,
      idempotencyKey: `import:${record.id}`,
      requestHash: hashCanonical(record),
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    } as unknown as typeof diaryEntries.$inferInsert;

    await this.db.insert(diaryEntries).values(values);
  }

  async insertTodo(
    userId: string,
    record: ExportTodoPaper,
  ): Promise<void> {
    const [paper] = await this.db
      .insert(todoPapers)
      .values({
        userId,
        businessDate: record.date,
        author: record.author,
        revision: record.revision,
        createdAt: new Date(record.created_at),
        updatedAt: new Date(record.updated_at),
      })
      .returning({ id: todoPapers.id });

    if (!paper) {
      throw new Error("todo paper insert failed");
    }

    if (record.entries.length > 0) {
      await this.db.insert(todoEntries).values(
        record.entries.map((entry, position) => ({
          paperId: paper.id,
          entryId: entry.id,
          kind: entry.kind,
          text: entry.text,
          position,
        })),
      );
    }
  }

  async rereadCreatedState(
    userId: string,
    modules: Set<ImportModule>,
  ): Promise<ImportCurrentState> {
    const state = await this.readCurrentState(userId);
    return {
      diary: modules.has("diary")
        ? state.diary
        : [],
      todo: modules.has("todo")
        ? state.todo
        : [],
    };
  }

  async recordAuditRun(
    userId: string,
    run: ImportAuditRun,
  ): Promise<void> {
    await this.db.insert(dataImportRuns).values({
      userId,
      packageSha256: run.package_sha256,
      previewFingerprint:
        run.preview_fingerprint,
      schemaVersion: run.schema_version,
      summary: run.summary,
    });
  }
}
