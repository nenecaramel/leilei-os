import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationAttachments,
  conversationContentBlocks,
  conversationMessages,
  conversations,
  diaryEntries,
  projectConversations,
  projectResources,
  projects,
  projectWorkspaces,
  resourceLifecycleEvents,
  runtimeSubjectStates,
  todoEntries,
  todoPapers,
  toolCalls,
  users,
} from "../../database/schema.js";
import { MCP_WRITE_TOOL_NAMES } from "../../mcp/tools/write-context.js";
import type { ExportRepository } from "./export-service.js";
import type {
  ExportConversationsBundle,
  ExportDiaryRecord,
  ExportLifecycleEvent,
  ExportMindStateRecord,
  ExportProjectsBundle,
  ExportToolActivity,
  ExportTodoPaper,
} from "./export-types.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;
type DbExecutor = Database | Transaction;

const toIso = (value: Date) => value.toISOString();

export class DrizzleExportRepository implements ExportRepository {
  constructor(private readonly db: DbExecutor) {}

  async withConsistentSnapshot<T>(
    work: (repository: ExportRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(
      async (transaction) =>
        work(
          new DrizzleExportRepository(
            transaction as Transaction,
          ),
        ),
      { isolationLevel: "repeatable read" },
    );
  }

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

  async listConversations(userId: string): Promise<ExportConversationsBundle> {
    const conversationRows = await this.db.select({
      id: conversations.id,
      title: conversations.title,
      lifecycleStatus: conversations.lifecycleStatus,
      currentHeadMessageId: conversations.currentHeadMessageId,
      defaultModel: conversations.defaultModel,
      providerMetadata: conversations.providerMetadata,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      archivedAt: conversations.archivedAt,
    }).from(conversations)
      .where(and(
        eq(conversations.userId, userId),
        eq(conversations.origin, "native_live"),
        inArray(conversations.lifecycleStatus, ["active", "archived"]),
      ))
      .orderBy(asc(conversations.createdAt), asc(conversations.id));

    const conversationIds = conversationRows.map((row) => row.id);
    const messageRows = conversationIds.length === 0
      ? []
      : await this.db.select({
          id: conversationMessages.id,
          conversationId: conversationMessages.conversationId,
          parentMessageId: conversationMessages.parentMessageId,
          role: conversationMessages.role,
          status: conversationMessages.status,
          rawRole: conversationMessages.rawRole,
          model: conversationMessages.model,
          isCurrentPath: conversationMessages.isCurrentPath,
          currentPathIndex: conversationMessages.currentPathIndex,
          turnIndex: conversationMessages.turnIndex,
          isPrimary: conversationMessages.isPrimary,
          displayText: conversationMessages.displayText,
          createdAt: conversationMessages.createdAt,
          completedAt: conversationMessages.completedAt,
          updatedAt: conversationMessages.updatedAt,
        }).from(conversationMessages)
          .where(and(
            eq(conversationMessages.userId, userId),
            inArray(conversationMessages.conversationId, conversationIds),
          ))
          .orderBy(
            asc(conversationMessages.conversationId),
            asc(conversationMessages.createdAt),
            asc(conversationMessages.id),
          );

    const messageIds = messageRows.map((row) => row.id);
    const [contentRows, attachmentRows] = messageIds.length === 0
      ? [[], []] as const
      : await Promise.all([
          this.db.select({
            id: conversationContentBlocks.id,
            messageId: conversationContentBlocks.messageId,
            ordinal: conversationContentBlocks.ordinal,
            kind: conversationContentBlocks.kind,
            rawType: conversationContentBlocks.rawType,
            text: conversationContentBlocks.text,
            payload: conversationContentBlocks.payload,
            createdAt: conversationContentBlocks.createdAt,
          }).from(conversationContentBlocks)
            .where(and(
              eq(conversationContentBlocks.userId, userId),
              inArray(conversationContentBlocks.messageId, messageIds),
            ))
            .orderBy(
              asc(conversationContentBlocks.messageId),
              asc(conversationContentBlocks.ordinal),
              asc(conversationContentBlocks.id),
            ),
          this.db.select({
            id: conversationAttachments.id,
            messageId: conversationAttachments.messageId,
            ordinal: conversationAttachments.ordinal,
            sourceAttachmentId: conversationAttachments.sourceAttachmentId,
            name: conversationAttachments.name,
            mimeType: conversationAttachments.mimeType,
            sizeBytes: conversationAttachments.sizeBytes,
            payload: conversationAttachments.payload,
          }).from(conversationAttachments)
            .where(and(
              eq(conversationAttachments.userId, userId),
              inArray(conversationAttachments.messageId, messageIds),
            ))
            .orderBy(
              asc(conversationAttachments.messageId),
              asc(conversationAttachments.ordinal),
              asc(conversationAttachments.id),
            ),
        ]);

    return {
      conversations: conversationRows.map((row) => ({
        id: row.id,
        title: row.title,
        lifecycle_status: row.lifecycleStatus as "active" | "archived",
        current_head_message_id: row.currentHeadMessageId,
        default_model: row.defaultModel,
        provider_metadata: row.providerMetadata,
        created_at: toIso(row.createdAt),
        updated_at: toIso(row.updatedAt),
        archived_at: row.archivedAt ? toIso(row.archivedAt) : null,
      })),
      messages: messageRows.map((row) => ({
        id: row.id,
        conversation_id: row.conversationId,
        parent_message_id: row.parentMessageId,
        role: row.role,
        status: row.status,
        raw_role: row.rawRole,
        model: row.model,
        is_current_path: row.isCurrentPath,
        current_path_index: row.currentPathIndex,
        turn_index: row.turnIndex,
        is_primary: row.isPrimary,
        display_text: row.displayText,
        created_at: toIso(row.createdAt),
        completed_at: row.completedAt ? toIso(row.completedAt) : null,
        updated_at: toIso(row.updatedAt),
      })),
      content_blocks: contentRows.map((row) => ({
        id: row.id,
        message_id: row.messageId,
        ordinal: row.ordinal,
        kind: row.kind,
        raw_type: row.rawType,
        text: row.text,
        payload: row.payload,
        created_at: toIso(row.createdAt),
      })),
      attachments: attachmentRows.map((row) => ({
        id: row.id,
        message_id: row.messageId,
        ordinal: row.ordinal,
        source_attachment_id: row.sourceAttachmentId,
        name: row.name,
        mime_type: row.mimeType,
        size_bytes: row.sizeBytes,
        payload: row.payload,
      })),
    };
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

  async listMind(userId: string): Promise<ExportMindStateRecord[]> {
    const rows = await this.db.select({
      id: runtimeSubjectStates.id,
      subjectId: runtimeSubjectStates.subjectId,
      kind: runtimeSubjectStates.kind,
      text: runtimeSubjectStates.text,
      payload: runtimeSubjectStates.payload,
      scopeApplicability: runtimeSubjectStates.scopeApplicability,
      scopeConversationId: runtimeSubjectStates.scopeConversationId,
      scopePathHeadMessageId: runtimeSubjectStates.scopePathHeadMessageId,
      settlementStatus: runtimeSubjectStates.settlementStatus,
      pathStatus: runtimeSubjectStates.pathStatus,
      validityStatus: runtimeSubjectStates.validityStatus,
      envelope: runtimeSubjectStates.envelope,
      createdAt: runtimeSubjectStates.createdAt,
      updatedAt: runtimeSubjectStates.updatedAt,
    }).from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.userId, userId))
      .orderBy(
        asc(runtimeSubjectStates.subjectId),
        asc(runtimeSubjectStates.kind),
        asc(runtimeSubjectStates.createdAt),
        asc(runtimeSubjectStates.id),
      );

    return rows.map((row) => ({
      id: row.id,
      subject_id: row.subjectId,
      kind: row.kind,
      text: row.text,
      payload: row.payload,
      scope_applicability: row.scopeApplicability,
      scope_conversation_id: row.scopeConversationId,
      scope_path_head_message_id: row.scopePathHeadMessageId,
      settlement_status: row.settlementStatus,
      path_status: row.pathStatus,
      validity_status: row.validityStatus,
      envelope: row.envelope,
      created_at: toIso(row.createdAt),
      updated_at: toIso(row.updatedAt),
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
