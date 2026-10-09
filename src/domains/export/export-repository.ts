import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationAttachments,
  conversationContentBlocks,
  conversationMessages,
  conversationProviderSessionCheckpoints,
  conversations,
  diaryComments,
  diaryEntries,
  nativeLiveBackgroundModelJobs,
  nativeLiveMindFollowUps,
  nativeLiveTurnPreparations,
  runtimeCuriosityResolutionEvents,
  runtimeDistillationWatermarks,
  runtimeDriveSatisfactionEvents,
  runtimeMindSemanticGroupingRequests,
  runtimeSubjectStates,
  todoEntries,
  todoPapers,
  users,
} from "../../database/schema.js";
import { DrizzleUniverseRepository } from "../universe/universe-repository-drizzle.js";
import type { ExportRepository } from "./export-service.js";
import type {
  ExportConversationsBundle,
  ExportDiaryCommentRecord,
  ExportDiaryRecord,
  ExportMindContinuityBundle,
  ExportMindStateRecord,
  ExportProjectsBundle,
  ExportTodoPaper,
  ExportUniverseBundle,
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

  async listDiaryComments(
    userId: string,
  ): Promise<ExportDiaryCommentRecord[]> {
    const rows = await this.db.select({
      id: diaryComments.id,
      diaryId: diaryComments.diaryId,
      author: diaryComments.author,
      content: diaryComments.content,
      revision: diaryComments.revision,
      createdAt: diaryComments.createdAt,
      updatedAt: diaryComments.updatedAt,
    }).from(diaryComments)
      .where(eq(diaryComments.userId, userId))
      .orderBy(
        asc(diaryComments.diaryId),
        asc(diaryComments.createdAt),
        asc(diaryComments.id),
      );

    return rows.map((row) => ({
      id: row.id,
      diary_id: row.diaryId,
      author: row.author,
      content: row.content,
      revision: row.revision,
      created_at: toIso(row.createdAt),
      updated_at: toIso(row.updatedAt),
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

  async listUniverse(
    userId: string,
  ): Promise<ExportUniverseBundle | null> {
    const result = await new DrizzleUniverseRepository(
      this.db as never,
    ).loadUniverseWeb(userId);
    if (!result) return null;
    return {
      version: result.version,
      snapshot: result.snapshot,
      diary_sources: result.sources.map((source) => ({
        node_id: source.nodeId,
        diary_id: source.diaryId,
      })),
    };
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
    const [
      contentRows,
      attachmentRows,
      checkpointRows,
    ] = messageIds.length === 0
      ? [[], [], []] as const
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
          this.db.select({
            id: conversationProviderSessionCheckpoints.id,
            conversationId:
              conversationProviderSessionCheckpoints.conversationId,
            canonicalMessageId:
              conversationProviderSessionCheckpoints.canonicalMessageId,
            provider:
              conversationProviderSessionCheckpoints.provider,
            providerSessionId:
              conversationProviderSessionCheckpoints.providerSessionId,
            effectiveWorkingDirectory:
              conversationProviderSessionCheckpoints.effectiveWorkingDirectory,
            runtimeMetadata:
              conversationProviderSessionCheckpoints.runtimeMetadata,
            providerCheckpointId:
              conversationProviderSessionCheckpoints.providerCheckpointId,
            createdAt:
              conversationProviderSessionCheckpoints.createdAt,
          }).from(conversationProviderSessionCheckpoints)
            .where(and(
              eq(
                conversationProviderSessionCheckpoints.userId,
                userId,
              ),
              inArray(
                conversationProviderSessionCheckpoints.canonicalMessageId,
                messageIds,
              ),
            ))
            .orderBy(
              asc(
                conversationProviderSessionCheckpoints.conversationId,
              ),
              asc(
                conversationProviderSessionCheckpoints.canonicalMessageId,
              ),
              asc(conversationProviderSessionCheckpoints.provider),
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
      provider_checkpoints: checkpointRows.map((row) => ({
        id: row.id,
        conversation_id: row.conversationId,
        canonical_message_id: row.canonicalMessageId,
        provider: row.provider,
        provider_session_id: row.providerSessionId,
        effective_working_directory: row.effectiveWorkingDirectory,
        runtime_metadata: row.runtimeMetadata,
        provider_checkpoint_id: row.providerCheckpointId,
        created_at: toIso(row.createdAt),
      })),
    };
  }

  // v3 restore compatibility still uses this historical projection in the
  // import repository. New exports never emit it.

  async hasIncompleteMindSemanticGrouping(
    userId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: runtimeMindSemanticGroupingRequests.id })
      .from(runtimeMindSemanticGroupingRequests)
      .where(and(
        eq(runtimeMindSemanticGroupingRequests.userId, userId),
        inArray(runtimeMindSemanticGroupingRequests.status, [
          "pending",
          "reserved",
        ]),
      ))
      .limit(1);
    return rows.length > 0;
  }

  async hasIncompleteBackgroundModelJobs(
    userId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: nativeLiveBackgroundModelJobs.id })
      .from(nativeLiveBackgroundModelJobs)
      .where(and(
        eq(nativeLiveBackgroundModelJobs.userId, userId),
        or(
          inArray(nativeLiveBackgroundModelJobs.status, [
            "pending",
            "reserved",
          ]),
          and(
            inArray(nativeLiveBackgroundModelJobs.status, [
              "completed",
              "failed",
            ]),
            isNull(nativeLiveBackgroundModelJobs.consumedAt),
          ),
        ),
      ))
      .limit(1);
    return rows.length > 0;
  }

  async hasIncompleteTurnPreparations(
    userId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: nativeLiveTurnPreparations.id })
      .from(nativeLiveTurnPreparations)
      .where(and(
        eq(nativeLiveTurnPreparations.userId, userId),
        eq(nativeLiveTurnPreparations.status, "prepared"),
        inArray(nativeLiveTurnPreparations.dispatchStatus, [
          "staged",
          "pending",
          "reserved",
          "executing",
        ]),
      ))
      .limit(1);
    return rows.length > 0;
  }

  async hasIncompleteMindFollowUps(
    userId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: nativeLiveMindFollowUps.prepareId })
      .from(nativeLiveMindFollowUps)
      .where(and(
        eq(nativeLiveMindFollowUps.userId, userId),
        inArray(nativeLiveMindFollowUps.status, [
          "pending",
          "processing",
        ]),
      ))
      .limit(1);
    return rows.length > 0;
  }

  async listMindContinuity(
    userId: string,
  ): Promise<ExportMindContinuityBundle> {
    const [
      driveRows,
      curiosityRows,
      watermarkRows,
      groupingRows,
    ] = await Promise.all([
      this.db.select({
        id: runtimeDriveSatisfactionEvents.id,
        subjectId: runtimeDriveSatisfactionEvents.subjectId,
        driveStateId: runtimeDriveSatisfactionEvents.driveStateId,
        conversationId: runtimeDriveSatisfactionEvents.conversationId,
        evidenceMessageId: runtimeDriveSatisfactionEvents.evidenceMessageId,
        evidenceBlockId: runtimeDriveSatisfactionEvents.evidenceBlockId,
        evidenceKind: runtimeDriveSatisfactionEvents.evidenceKind,
        amount: runtimeDriveSatisfactionEvents.amount,
        idempotencyKey: runtimeDriveSatisfactionEvents.idempotencyKey,
        createdAt: runtimeDriveSatisfactionEvents.createdAt,
      }).from(runtimeDriveSatisfactionEvents)
        .where(eq(runtimeDriveSatisfactionEvents.userId, userId))
        .orderBy(
          asc(runtimeDriveSatisfactionEvents.createdAt),
          asc(runtimeDriveSatisfactionEvents.id),
        ),
      this.db.select({
        id: runtimeCuriosityResolutionEvents.id,
        subjectId: runtimeCuriosityResolutionEvents.subjectId,
        curiosityStateId: runtimeCuriosityResolutionEvents.curiosityStateId,
        conversationId: runtimeCuriosityResolutionEvents.conversationId,
        requestedResolutionSourceId:
          runtimeCuriosityResolutionEvents.requestedResolutionSourceId,
        resultResolutionSourceId:
          runtimeCuriosityResolutionEvents.resultResolutionSourceId,
        resolvedAt: runtimeCuriosityResolutionEvents.resolvedAt,
        idempotencyKey: runtimeCuriosityResolutionEvents.idempotencyKey,
        createdAt: runtimeCuriosityResolutionEvents.createdAt,
      }).from(runtimeCuriosityResolutionEvents)
        .where(eq(runtimeCuriosityResolutionEvents.userId, userId))
        .orderBy(
          asc(runtimeCuriosityResolutionEvents.createdAt),
          asc(runtimeCuriosityResolutionEvents.id),
        ),
      this.db.select({
        subjectId: runtimeDistillationWatermarks.subjectId,
        conversationId: runtimeDistillationWatermarks.conversationId,
        lastSourceMessageId:
          runtimeDistillationWatermarks.lastSourceMessageId,
        processVersion: runtimeDistillationWatermarks.processVersion,
        updatedAt: runtimeDistillationWatermarks.updatedAt,
      }).from(runtimeDistillationWatermarks)
        .where(eq(runtimeDistillationWatermarks.userId, userId))
        .orderBy(
          asc(runtimeDistillationWatermarks.subjectId),
          asc(runtimeDistillationWatermarks.conversationId),
        ),
      this.db.select({
        id: runtimeMindSemanticGroupingRequests.id,
        subjectId: runtimeMindSemanticGroupingRequests.subjectId,
        kind: runtimeMindSemanticGroupingRequests.kind,
        queryStateId: runtimeMindSemanticGroupingRequests.queryStateId,
        query: runtimeMindSemanticGroupingRequests.query,
        candidates: runtimeMindSemanticGroupingRequests.candidates,
        scores: runtimeMindSemanticGroupingRequests.scores,
        createdAt: runtimeMindSemanticGroupingRequests.createdAt,
        updatedAt: runtimeMindSemanticGroupingRequests.updatedAt,
        completedAt: runtimeMindSemanticGroupingRequests.completedAt,
      }).from(runtimeMindSemanticGroupingRequests)
        .where(and(
          eq(runtimeMindSemanticGroupingRequests.userId, userId),
          eq(runtimeMindSemanticGroupingRequests.status, "completed"),
        ))
        .orderBy(
          asc(runtimeMindSemanticGroupingRequests.completedAt),
          asc(runtimeMindSemanticGroupingRequests.id),
        ),
    ]);

    return {
      drive_satisfaction_events: driveRows.map((row) => ({
        id: row.id,
        subject_id: row.subjectId,
        drive_state_id: row.driveStateId,
        conversation_id: row.conversationId,
        evidence_message_id: row.evidenceMessageId,
        evidence_block_id: row.evidenceBlockId,
        evidence_kind: row.evidenceKind,
        amount: row.amount,
        idempotency_key: row.idempotencyKey,
        created_at: toIso(row.createdAt),
      })),
      curiosity_resolution_events: curiosityRows.map((row) => ({
        id: row.id,
        subject_id: row.subjectId,
        curiosity_state_id: row.curiosityStateId,
        conversation_id: row.conversationId,
        requested_resolution_source_id:
          row.requestedResolutionSourceId,
        result_resolution_source_id:
          row.resultResolutionSourceId,
        resolved_at: toIso(row.resolvedAt),
        idempotency_key: row.idempotencyKey,
        created_at: toIso(row.createdAt),
      })),
      distillation_watermarks: watermarkRows.map((row) => ({
        subject_id: row.subjectId,
        conversation_id: row.conversationId,
        last_source_message_id: row.lastSourceMessageId,
        process_version: row.processVersion,
        updated_at: toIso(row.updatedAt),
      })),
      semantic_grouping_results: groupingRows.map((row) => {
        if (!row.scores || !row.completedAt) {
          throw new Error(
            "Completed Mind semantic grouping result is incomplete.",
          );
        }
        return {
          id: row.id,
          subject_id: row.subjectId,
          kind: row.kind as "drive" | "thought" | "curiosity" | "topic",
          query_state_id: row.queryStateId,
          query: row.query,
          candidates: row.candidates,
          scores: row.scores,
          created_at: toIso(row.createdAt),
          updated_at: toIso(row.updatedAt),
          completed_at: toIso(row.completedAt),
        };
      }),
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
      .where(and(
        eq(runtimeSubjectStates.userId, userId),
        eq(runtimeSubjectStates.kind, "memory"),
      ))
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

}
