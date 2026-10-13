import {
  and,
  eq,
} from "drizzle-orm";
import {
  conversationAttachments,
  conversationContentBlocks,
  conversationMessages,
  conversationProviderSessionCheckpoints,
  conversations,
  dataImportRuns,
  diaryComments,
  diaryEntries,
  runtimeCuriosityResolutionEvents,
  runtimeDistillationWatermarks,
  runtimeDriveSatisfactionEvents,
  runtimeMindSemanticGroupingRequests,
  runtimeSubjectStates,
  universeDiarySources,
  universeGalaxies,
  universeMeta,
  universeNodes,
  universeRelations,
  universeRevisions,
  todoEntries,
  todoPapers,
  users,
} from "../../database/schema.js";
import type {
  ExportConversationAttachmentRecord,
  ExportConversationContentBlockRecord,
  ExportConversationMessageRecord,
  ExportConversationProviderCheckpointRecord,
  ExportConversationRecord,
  ExportConversationsBundle,
  ExportDiaryCommentRecord,
  ExportDiaryRecord,
  ExportMindCuriosityResolutionEventRecord,
  ExportMindDistillationWatermarkRecord,
  ExportMindDriveSatisfactionEventRecord,
  ExportMindSemanticGroupingResultRecord,
  HistoricalMindStateRecord,
  ExportTodoPaper,
  ExportUniverseBundle,
} from "../export/export-types.js";
import {
  hashCanonical,
} from "./import-canonical.js";
import type {
  ImportCurrentState,
  ImportModule,
} from "./import-planner.js";

import type {
  DbExecutor,
  Transaction,
  ImportAuditRun,
  ImportRepository,
} from "./import-repository-types.js";
import {
  readImportCurrentState,
} from "./import-current-state-reader.js";
export type { ImportAuditRun, ImportRepository } from "./import-repository-types.js";

const emptyConversations = (): ExportConversationsBundle => ({
  conversations: [],
  messages: [],
  content_blocks: [],
  attachments: [],
  provider_checkpoints: [],
});

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

  async readCurrentState(userId: string): Promise<ImportCurrentState> {
    return readImportCurrentState(this.db, userId);
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

  async insertDiaryComment(
    userId: string,
    record: ExportDiaryCommentRecord,
  ): Promise<void> {
    await this.db.insert(diaryComments).values({
      id: record.id,
      userId,
      diaryId: record.diary_id,
      author: record.author,
      content: record.content,
      revision: record.revision,
      idempotencyKey: `restore:${record.id}`,
      requestHash: hashCanonical(record),
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    });
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

  async insertUniverse(
    userId: string,
    record: ExportUniverseBundle,
  ): Promise<void> {
    const snapshot = record.snapshot;

    await this.db.insert(universeMeta).values({
      userId,
      name: snapshot.meta.name,
      schemaVersion: snapshot.schemaVersion,
      createdAt: new Date(snapshot.meta.createdAt),
      updatedAt: new Date(snapshot.meta.updatedAt),
      version: record.version,
    });

    if (snapshot.galaxies.length > 0) {
      await this.db.insert(universeGalaxies).values(
        snapshot.galaxies.map((galaxy) => ({
          userId,
          id: galaxy.id,
          title: galaxy.title,
          description: galaxy.description,
          color: galaxy.color,
          order: galaxy.order,
        })),
      );
    }

    if (snapshot.nodes.length > 0) {
      await this.db.insert(universeNodes).values(
        snapshot.nodes.map((node) => ({
          userId,
          id: node.id,
          title: node.title,
          summary: node.summary,
          content: node.content,
          type: node.type,
          tags: node.tags,
          galaxies: [],
          galaxyMemberships: node.galaxies,
          position: node.position,
          createdAt: new Date(node.createdAt),
          updatedAt: new Date(node.updatedAt),
          importance: node.importance ?? null,
          migration: node.migration ?? null,
        })),
      );
    }

    if (snapshot.relations.length > 0) {
      await this.db.insert(universeRelations).values(
        snapshot.relations.map((relation) => ({
          userId,
          id: relation.id,
          source: relation.source,
          target: relation.target,
          relationType: relation.relationType,
          strength: relation.strength,
          createdAt: new Date(relation.createdAt),
        })),
      );
    }

    if (snapshot.revisions.length > 0) {
      await this.db.insert(universeRevisions).values(
        snapshot.revisions.map((revision) => ({
          userId,
          id: revision.id,
          nodeId: revision.nodeId,
          createdAt: new Date(revision.createdAt),
          reason: revision.reason,
          snapshot: revision.snapshot,
        })),
      );
    }

    if (record.diary_sources.length > 0) {
      await this.db.insert(universeDiarySources).values(
        record.diary_sources.map((source) => ({
          userId,
          nodeId: source.node_id,
          diaryId: source.diary_id,
        })),
      );
    }
  }

  async insertConversation(
    userId: string,
    record: ExportConversationRecord,
  ): Promise<void> {
    await this.db.insert(conversations).values({
      id: record.id,
      userId,
      origin: "native_live",
      provider: null,
      sourceConversationId: null,
      title: record.title,
      lifecycleStatus: record.lifecycle_status,
      currentHeadMessageId: null,
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      currentLeafSourceNodeId: null,
      defaultModel: record.default_model,
      providerMetadata: record.provider_metadata,
      sourceFingerprint: null,
      firstSeenImportId: null,
      lastSeenImportId: null,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
      archivedAt: record.archived_at
        ? new Date(record.archived_at)
        : null,
      deletedAt: null,
    });
  }

  async insertConversationMessage(
    userId: string,
    record: ExportConversationMessageRecord,
  ): Promise<void> {
    await this.db.insert(conversationMessages).values({
      id: record.id,
      userId,
      conversationId: record.conversation_id,
      sourceNodeId: null,
      sourceMessageId: null,
      parentSourceNodeId: null,
      parentMessageId: record.parent_message_id,
      role: record.role,
      status: record.status,
      rawRole: record.raw_role,
      model: record.model,
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      isCurrentPath: record.is_current_path,
      currentPathIndex: record.current_path_index,
      turnIndex: record.turn_index,
      isPrimary: record.is_primary,
      displayText: record.display_text,
      sourceFingerprint: null,
      firstSeenImportId: null,
      lastSeenImportId: null,
      createdAt: new Date(record.created_at),
      completedAt: record.completed_at
        ? new Date(record.completed_at)
        : null,
      updatedAt: new Date(record.updated_at),
    });
  }

  async setConversationCurrentHead(
    userId: string,
    conversationId: string,
    currentHeadMessageId: string,
  ): Promise<void> {
    await this.db
      .update(conversations)
      .set({
        currentHeadMessageId,
      })
      .where(and(
        eq(conversations.userId, userId),
        eq(conversations.id, conversationId),
      ));
  }

  async insertConversationContentBlock(
    userId: string,
    record: ExportConversationContentBlockRecord,
  ): Promise<void> {
    await this.db.insert(conversationContentBlocks).values({
      id: record.id,
      userId,
      messageId: record.message_id,
      ordinal: record.ordinal,
      kind: record.kind,
      rawType: record.raw_type,
      text: record.text,
      payload: record.payload,
      createdAt: new Date(record.created_at),
    });
  }

  async insertConversationAttachment(
    userId: string,
    record: ExportConversationAttachmentRecord,
  ): Promise<void> {
    await this.db.insert(conversationAttachments).values({
      id: record.id,
      userId,
      messageId: record.message_id,
      ordinal: record.ordinal,
      sourceAttachmentId: record.source_attachment_id,
      name: record.name,
      mimeType: record.mime_type,
      sizeBytes: record.size_bytes,
      payload: record.payload,
    });
  }

  async insertConversationProviderCheckpoint(
    userId: string,
    record: ExportConversationProviderCheckpointRecord,
  ): Promise<void> {
    await this.db
      .insert(conversationProviderSessionCheckpoints)
      .values({
        id: record.id,
        userId,
        conversationId: record.conversation_id,
        canonicalMessageId: record.canonical_message_id,
        provider: record.provider,
        providerSessionId: record.provider_session_id,
        effectiveWorkingDirectory: record.effective_working_directory,
        runtimeMetadata: record.runtime_metadata,
        providerCheckpointId: record.provider_checkpoint_id,
        createdAt: new Date(record.created_at),
      });
  }

  async insertMind(
    userId: string,
    record: HistoricalMindStateRecord,
  ): Promise<void> {
    if (record.kind !== "memory") throw new Error("Import writes require the current memory kind.");
    await this.db.insert(runtimeSubjectStates).values({
      id: record.id,
      userId,
      subjectId: record.subject_id,
      kind: record.kind,
      text: record.text,
      payload: record.payload,
      scopeApplicability: record.scope_applicability,
      scopeConversationId: record.scope_conversation_id,
      scopePathHeadMessageId: record.scope_path_head_message_id,
      settlementStatus: record.settlement_status,
      pathStatus: record.path_status,
      validityStatus: record.validity_status,
      envelope: record.envelope,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    });
  }

  async insertMindDriveSatisfactionEvent(
    userId: string,
    record: ExportMindDriveSatisfactionEventRecord,
  ): Promise<void> {
    await this.db.insert(runtimeDriveSatisfactionEvents).values({
      id: record.id,
      userId,
      subjectId: record.subject_id,
      driveStateId: record.drive_state_id,
      conversationId: record.conversation_id,
      evidenceMessageId: record.evidence_message_id,
      evidenceBlockId: record.evidence_block_id,
      evidenceKind: record.evidence_kind,
      amount: record.amount,
      idempotencyKey: record.idempotency_key,
      createdAt: new Date(record.created_at),
    });
  }

  async insertMindCuriosityResolutionEvent(
    userId: string,
    record: ExportMindCuriosityResolutionEventRecord,
  ): Promise<void> {
    await this.db.insert(runtimeCuriosityResolutionEvents).values({
      id: record.id,
      userId,
      subjectId: record.subject_id,
      curiosityStateId: record.curiosity_state_id,
      conversationId: record.conversation_id,
      requestedResolutionSourceId:
        record.requested_resolution_source_id,
      resultResolutionSourceId:
        record.result_resolution_source_id,
      resolvedAt: new Date(record.resolved_at),
      idempotencyKey: record.idempotency_key,
      createdAt: new Date(record.created_at),
    });
  }

  async insertMindDistillationWatermark(
    userId: string,
    record: ExportMindDistillationWatermarkRecord,
  ): Promise<void> {
    await this.db.insert(runtimeDistillationWatermarks).values({
      userId,
      subjectId: record.subject_id,
      conversationId: record.conversation_id,
      lastSourceMessageId: record.last_source_message_id,
      processVersion: record.process_version,
      updatedAt: new Date(record.updated_at),
    });
  }

  async insertMindSemanticGroupingResult(
    userId: string,
    record: ExportMindSemanticGroupingResultRecord,
  ): Promise<void> {
    await this.db
      .insert(runtimeMindSemanticGroupingRequests)
      .values({
        id: record.id,
        userId,
        subjectId: record.subject_id,
        kind: record.kind,
        queryStateId: record.query_state_id,
        query: record.query,
        candidates: record.candidates,
        status: "completed",
        reservedBy: null,
        reservedAt: null,
        reservationExpiresAt: null,
        scores: record.scores,
        fallbackCode: null,
        createdAt: new Date(record.created_at),
        updatedAt: new Date(record.updated_at),
        completedAt: new Date(record.completed_at),
      });
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
      diary_comments: modules.has("diary_comments")
        ? state.diary_comments
        : undefined,
      todo: modules.has("todo")
        ? state.todo
        : [],
      universe: modules.has("universe")
        ? state.universe
        : undefined,
      mind: modules.has("mind")
        ? state.mind
        : undefined,
      mind_continuity: modules.has("mind")
        ? state.mind_continuity
        : undefined,
      conversations: modules.has("conversations")
        ? state.conversations
        : emptyConversations(),
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
