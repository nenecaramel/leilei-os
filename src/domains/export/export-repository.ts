import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  coreMemories,
  diaryEntries,
  resourceLifecycleEvents,
  tasks,
  todoEntries,
  todoPapers,
  toolCalls,
  users,
} from "../../database/schema.js";
import { MCP_WRITE_TOOL_NAMES } from "../../mcp/tools/write-context.js";
import type { ExportRepository } from "./export-service.js";
import type {
  ExportDiaryRecord,
  ExportLifecycleEvent,
  ExportMemoryRecord,
  ExportTaskRecord,
  ExportToolActivity,
  ExportTodoPaper,
} from "./export-types.js";

type Database = ReturnType<typeof createDatabase>["db"];
const toIso = (value: Date) => value.toISOString();

export class DrizzleExportRepository implements ExportRepository {
  constructor(private readonly db: Database) {}

  async findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null> {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user ?? null;
  }

  async listMemory(userId: string): Promise<ExportMemoryRecord[]> {
    const rows = await this.db.select({
      id: coreMemories.id, category: coreMemories.category, key: coreMemories.key,
      content: coreMemories.content, tags: coreMemories.tags, visibility: coreMemories.visibility,
      source: coreMemories.source, author: coreMemories.author, status: coreMemories.status,
      sortOrder: coreMemories.sortOrder, createdAt: coreMemories.createdAt, updatedAt: coreMemories.updatedAt,
    }).from(coreMemories).where(eq(coreMemories.userId, userId))
      .orderBy(asc(coreMemories.createdAt), asc(coreMemories.id));
    return rows.map((row) => ({
      id: row.id, category: row.category, key: row.key, content: row.content, tags: row.tags,
      visibility: row.visibility, source: row.source, author: row.author, status: row.status,
      sort_order: row.sortOrder, created_at: toIso(row.createdAt), updated_at: toIso(row.updatedAt),
    }));
  }

  async listDiary(userId: string): Promise<ExportDiaryRecord[]> {
    const rows = await this.db.select({
      id: diaryEntries.id, title: diaryEntries.title, content: diaryEntries.content,
      date: diaryEntries.date, tags: diaryEntries.tags, mood: diaryEntries.mood,
      source: diaryEntries.source, author: diaryEntries.author, status: diaryEntries.status,
      createdAt: diaryEntries.createdAt, updatedAt: diaryEntries.updatedAt,
    }).from(diaryEntries).where(eq(diaryEntries.userId, userId))
      .orderBy(asc(diaryEntries.date), asc(diaryEntries.createdAt), asc(diaryEntries.id));
    return rows.map((row) => ({
      id: row.id, title: row.title, content: row.content, date: row.date, tags: row.tags,
      mood: row.mood, source: row.source, author: row.author, status: row.status,
      created_at: toIso(row.createdAt), updated_at: toIso(row.updatedAt),
    }));
  }

  async listTasks(userId: string): Promise<ExportTaskRecord[]> {
    const rows = await this.db.select({
      id: tasks.id, title: tasks.title, description: tasks.description, status: tasks.status,
      resumeStatus: tasks.resumeStatus, lifecycleStatus: tasks.lifecycleStatus, author: tasks.author,
      priority: tasks.priority, dueTime: tasks.dueTime, timezone: tasks.timezone, tags: tasks.tags,
      createdAt: tasks.createdAt, updatedAt: tasks.updatedAt, completedAt: tasks.completedAt,
    }).from(tasks).where(eq(tasks.userId, userId)).orderBy(asc(tasks.createdAt), asc(tasks.id));
    return rows.map((row) => ({
      id: row.id, title: row.title, description: row.description, status: row.status,
      resume_status: row.resumeStatus, lifecycle_status: row.lifecycleStatus, author: row.author,
      priority: row.priority, due_time: row.dueTime ? toIso(row.dueTime) : null, timezone: row.timezone,
      tags: row.tags, created_at: toIso(row.createdAt), updated_at: toIso(row.updatedAt),
      completed_at: row.completedAt ? toIso(row.completedAt) : null,
    }));
  }

  async listTodo(userId: string): Promise<ExportTodoPaper[]> {
    const papers = await this.db.select({
      id: todoPapers.id, date: todoPapers.businessDate, author: todoPapers.author,
      revision: todoPapers.revision, createdAt: todoPapers.createdAt, updatedAt: todoPapers.updatedAt,
    }).from(todoPapers).where(eq(todoPapers.userId, userId))
      .orderBy(asc(todoPapers.businessDate), asc(todoPapers.author));
    const entries = papers.length === 0 ? [] : await this.db.select({
      paperId: todoEntries.paperId, id: todoEntries.entryId, kind: todoEntries.kind,
      text: todoEntries.text, position: todoEntries.position,
    }).from(todoEntries).where(inArray(todoEntries.paperId, papers.map((paper) => paper.id)))
      .orderBy(asc(todoEntries.paperId), asc(todoEntries.position));
    const grouped = new Map<string, Array<{ id: string; kind: "pending" | "completed" | "record"; text: string }>>();
    for (const entry of entries) {
      const list = grouped.get(entry.paperId) ?? [];
      list.push({ id: entry.id, kind: entry.kind, text: entry.text });
      grouped.set(entry.paperId, list);
    }
    return papers.map((paper) => ({
      date: paper.date, author: paper.author, revision: paper.revision,
      created_at: toIso(paper.createdAt), updated_at: toIso(paper.updatedAt), entries: grouped.get(paper.id) ?? [],
    }));
  }

  async listLifecycleAudit(userId: string): Promise<ExportLifecycleEvent[]> {
    const rows = await this.db.select({
      id: resourceLifecycleEvents.id, resourceType: resourceLifecycleEvents.resourceType,
      resourceId: resourceLifecycleEvents.resourceId, action: resourceLifecycleEvents.action,
      actorType: resourceLifecycleEvents.actorType, channel: resourceLifecycleEvents.channel,
      createdAt: resourceLifecycleEvents.createdAt,
    }).from(resourceLifecycleEvents).where(eq(resourceLifecycleEvents.userId, userId))
      .orderBy(asc(resourceLifecycleEvents.createdAt), asc(resourceLifecycleEvents.id));
    return rows.map((row) => ({
      id: row.id, resource_type: row.resourceType, resource_id: row.resourceId, action: row.action,
      actor_type: row.actorType, channel: row.channel, created_at: toIso(row.createdAt),
    }));
  }

  async listToolActivity(userId: string): Promise<ExportToolActivity[]> {
    const rows = await this.db.select({
      id: toolCalls.id, toolName: toolCalls.toolName, operation: toolCalls.operation,
      resourceType: toolCalls.resourceType, resourceId: toolCalls.resourceId,
      status: toolCalls.status, errorCode: toolCalls.errorCode, createdAt: toolCalls.createdAt,
    }).from(toolCalls).where(and(
      eq(toolCalls.userId, userId),
      inArray(toolCalls.toolName, [...MCP_WRITE_TOOL_NAMES]),
      isNotNull(toolCalls.idempotencyKey),
      isNotNull(toolCalls.resourceId),
    ))
      .orderBy(asc(toolCalls.createdAt), asc(toolCalls.id));
    return rows.map((row) => ({
      id: row.id, tool_name: row.toolName, operation: row.operation, resource_type: row.resourceType,
      resource_id: row.resourceId, status: row.status, error_code: row.errorCode,
      created_at: toIso(row.createdAt),
    }));
  }
}
