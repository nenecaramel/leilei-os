import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  diaryEntries,
  projectConversations,
  projectResources,
  projects,
  projectWorkspaces,
  resourceLifecycleEvents,
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
  ExportProjectsBundle,
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

  async listProjects(userId: string): Promise<ExportProjectsBundle> {
    const [workspaceRows, projectRows, resourceRows, conversationRows] = await Promise.all([
      this.db.select({
        id: projectWorkspaces.id,
        name: projectWorkspaces.name,
        description: projectWorkspaces.description,
        version: projectWorkspaces.version,
        createdAt: projectWorkspaces.createdAt,
        updatedAt: projectWorkspaces.updatedAt,
      }).from(projectWorkspaces)
        .where(eq(projectWorkspaces.userId, userId))
        .orderBy(asc(projectWorkspaces.createdAt), asc(projectWorkspaces.id)),
      this.db.select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        name: projects.name,
        description: projects.description,
        version: projects.version,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      }).from(projects)
        .where(eq(projects.userId, userId))
        .orderBy(asc(projects.createdAt), asc(projects.id)),
      this.db.select({
        id: projectResources.id,
        projectId: projectResources.projectId,
        kind: projectResources.kind,
        key: projectResources.resourceKey,
        title: projectResources.title,
        content: projectResources.content,
        metadata: projectResources.metadata,
        version: projectResources.version,
        createdAt: projectResources.createdAt,
        updatedAt: projectResources.updatedAt,
      }).from(projectResources)
        .where(eq(projectResources.userId, userId))
        .orderBy(
          asc(projectResources.projectId),
          asc(projectResources.kind),
          asc(projectResources.resourceKey),
          asc(projectResources.id),
        ),
      this.db.select({
        projectId: projectConversations.projectId,
        conversationId: projectConversations.conversationId,
        addedAt: projectConversations.addedAt,
      }).from(projectConversations)
        .where(eq(projectConversations.userId, userId))
        .orderBy(
          asc(projectConversations.projectId),
          asc(projectConversations.addedAt),
          asc(projectConversations.conversationId),
        ),
    ]);

    return {
      workspaces: workspaceRows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        version: row.version,
        created_at: toIso(row.createdAt),
        updated_at: toIso(row.updatedAt),
      })),
      projects: projectRows.map((row) => ({
        id: row.id,
        workspace_id: row.workspaceId,
        name: row.name,
        description: row.description,
        version: row.version,
        created_at: toIso(row.createdAt),
        updated_at: toIso(row.updatedAt),
      })),
      resources: resourceRows.map((row) => ({
        id: row.id,
        project_id: row.projectId,
        kind: row.kind,
        key: row.key,
        title: row.title,
        content: row.content,
        metadata: row.metadata,
        version: row.version,
        created_at: toIso(row.createdAt),
        updated_at: toIso(row.updatedAt),
      })),
      conversations: conversationRows.map((row) => ({
        project_id: row.projectId,
        conversation_id: row.conversationId,
        added_at: toIso(row.addedAt),
      })),
    };
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
