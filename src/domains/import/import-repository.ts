import { and, asc, eq, inArray } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  coreMemories,
  dataImportRuns,
  diaryEntries,
  tasks,
  todoEntries,
  todoPapers,
} from "../../database/schema.js";
import type {
  ExportDiaryRecord,
  ExportMemoryRecord,
  ExportTaskRecord,
  ExportTodoPaper,
} from "../export/export-types.js";
import { hashCanonical } from "./import-canonical.js";
import type { ImportCurrentState } from "./import-planner.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (tx: infer T) => unknown ? T : never;
type DbExecutor = Database | Transaction;

export type ImportAuditRun = {
  package_sha256: string;
  preview_fingerprint: string;
  schema_version: number;
  summary: Record<string, unknown>;
};

export interface ImportRepository {
  withTransaction<T>(work: (repository: ImportRepository) => Promise<T>): Promise<T>;
  readCurrentState(userId: string): Promise<ImportCurrentState>;
  insertMemory(userId: string, record: ExportMemoryRecord): Promise<void>;
  insertDiary(userId: string, record: ExportDiaryRecord): Promise<void>;
  insertTask(userId: string, record: ExportTaskRecord): Promise<void>;
  insertTodo(userId: string, record: ExportTodoPaper): Promise<void>;
  rereadCreatedState(userId: string, modules: Set<keyof ImportCurrentState>): Promise<ImportCurrentState>;
  recordAuditRun(userId: string, run: ImportAuditRun): Promise<void>;
}

const toIso = (value: Date): string => value.toISOString();

export class DrizzleImportRepository implements ImportRepository {
  constructor(private readonly db: DbExecutor) {}

  async withTransaction<T>(work: (repository: ImportRepository) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => work(new DrizzleImportRepository(tx as Transaction)));
  }

  async readCurrentState(userId: string): Promise<ImportCurrentState> {
    const [memory, diary, task, papers, allMemory, allDiary, allTask] = await Promise.all([
      this.db.select().from(coreMemories).where(eq(coreMemories.userId, userId)).orderBy(asc(coreMemories.id)),
      this.db.select().from(diaryEntries).where(eq(diaryEntries.userId, userId)).orderBy(asc(diaryEntries.id)),
      this.db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(asc(tasks.id)),
      this.db.select().from(todoPapers).where(eq(todoPapers.userId, userId)).orderBy(asc(todoPapers.businessDate), asc(todoPapers.author)),
      this.db.select({ id: coreMemories.id }).from(coreMemories),
      this.db.select({ id: diaryEntries.id }).from(diaryEntries),
      this.db.select({ id: tasks.id }).from(tasks),
    ]);
    const entries = papers.length === 0 ? [] : await this.db.select({
      paperId: todoEntries.paperId, id: todoEntries.entryId, kind: todoEntries.kind, text: todoEntries.text,
    }).from(todoEntries).where(inArray(todoEntries.paperId, papers.map((paper) => paper.id))).orderBy(asc(todoEntries.paperId), asc(todoEntries.position));
    const grouped = new Map<string, Array<{ id: string; kind: "pending" | "completed" | "record"; text: string }>>();
    for (const entry of entries) {
      const list = grouped.get(entry.paperId) ?? [];
      list.push({ id: entry.id, kind: entry.kind, text: entry.text });
      grouped.set(entry.paperId, list);
    }
    return {
      memory: memory.map((row) => ({
        id: row.id, category: row.category, key: row.key, content: row.content, tags: row.tags,
        visibility: row.visibility, source: row.source, author: row.author, status: row.status,
        sort_order: row.sortOrder, created_at: toIso(row.createdAt), updated_at: toIso(row.updatedAt),
      })),
      diary: diary.map((row) => ({
        id: row.id, title: row.title, content: row.content, date: row.date, tags: row.tags, mood: row.mood,
        source: row.source, author: row.author, status: row.status, created_at: toIso(row.createdAt), updated_at: toIso(row.updatedAt),
      })),
      task: task.map((row) => ({
        id: row.id, title: row.title, description: row.description, status: row.status, resume_status: row.resumeStatus,
        lifecycle_status: row.lifecycleStatus, author: row.author, priority: row.priority,
        due_time: row.dueTime ? toIso(row.dueTime) : null, timezone: row.timezone, tags: row.tags,
        created_at: toIso(row.createdAt), updated_at: toIso(row.updatedAt), completed_at: row.completedAt ? toIso(row.completedAt) : null,
      })),
      todo: papers.map((row) => ({
        date: row.businessDate, author: row.author, revision: row.revision, created_at: toIso(row.createdAt), updated_at: toIso(row.updatedAt),
        entries: grouped.get(row.id) ?? [],
      })),
      foreign_memory_ids: new Set(allMemory.map((row) => row.id)),
      foreign_diary_ids: new Set(allDiary.map((row) => row.id)),
      foreign_task_ids: new Set(allTask.map((row) => row.id)),
    };
  }

  async insertMemory(userId: string, record: ExportMemoryRecord): Promise<void> {
    const values = {
      id: record.id, userId, category: record.category, key: record.key, content: record.content,
      tags: record.tags, visibility: record.visibility, source: record.source, author: record.author,
      status: record.status, sortOrder: record.sort_order, createdAt: new Date(record.created_at), updatedAt: new Date(record.updated_at),
    } as unknown as typeof coreMemories.$inferInsert;
    await this.db.insert(coreMemories).values(values);
  }

  async insertDiary(userId: string, record: ExportDiaryRecord): Promise<void> {
    const values = {
      id: record.id, userId, title: record.title, content: record.content, date: record.date, tags: record.tags,
      mood: record.mood, source: record.source as "chatgpt_mcp", author: record.author, status: record.status,
      idempotencyKey: `import:${record.id}`, requestHash: hashCanonical(record),
      createdAt: new Date(record.created_at), updatedAt: new Date(record.updated_at),
    } as unknown as typeof diaryEntries.$inferInsert;
    await this.db.insert(diaryEntries).values(values);
  }

  async insertTask(userId: string, record: ExportTaskRecord): Promise<void> {
    const values = {
      id: record.id, userId, title: record.title, description: record.description, status: record.status,
      resumeStatus: record.resume_status === "completed" || record.resume_status === "cancelled" ? null : record.resume_status,
      lifecycleStatus: record.lifecycle_status, author: record.author, priority: record.priority,
      dueTime: record.due_time ? new Date(record.due_time) : null, timezone: record.timezone, tags: record.tags,
      createdAt: new Date(record.created_at), updatedAt: new Date(record.updated_at), completedAt: record.completed_at ? new Date(record.completed_at) : null,
    } as unknown as typeof tasks.$inferInsert;
    await this.db.insert(tasks).values(values);
  }

  async insertTodo(userId: string, record: ExportTodoPaper): Promise<void> {
    const [paper] = await this.db.insert(todoPapers).values({
      userId, businessDate: record.date, author: record.author, revision: record.revision,
      createdAt: new Date(record.created_at), updatedAt: new Date(record.updated_at),
    }).returning({ id: todoPapers.id });
    if (!paper) throw new Error("todo paper insert failed");
    if (record.entries.length > 0) {
      await this.db.insert(todoEntries).values(record.entries.map((entry, position) => ({
        paperId: paper.id, entryId: entry.id, kind: entry.kind, text: entry.text, position,
      })));
    }
  }

  async rereadCreatedState(userId: string, modules: Set<keyof ImportCurrentState>): Promise<ImportCurrentState> {
    const state = await this.readCurrentState(userId);
    return {
      memory: modules.has("memory") ? state.memory : [],
      diary: modules.has("diary") ? state.diary : [],
      task: modules.has("task") ? state.task : [],
      todo: modules.has("todo") ? state.todo : [],
    };
  }

  async recordAuditRun(userId: string, run: ImportAuditRun): Promise<void> {
    await this.db.insert(dataImportRuns).values({
      userId, packageSha256: run.package_sha256, previewFingerprint: run.preview_fingerprint,
      schemaVersion: run.schema_version, summary: run.summary,
    });
  }
}
