import { and, asc, eq, inArray } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationAttachments,
  conversationContentBlocks,
  conversationMessages,
  conversationProviderSessionCheckpoints,
  conversations,
  dataImportRuns,
  diaryComments,
  diaryEntries,
  projectConversations,
  projectResources,
  projects,
  projectWorkspaces,
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
  ExportMindStateRecord,
  ExportProjectConversationRecord,
  ExportProjectRecord,
  ExportProjectResourceRecord,
  ExportProjectsBundle,
  ExportProjectWorkspaceRecord,
  ExportTodoPaper,
  ExportUniverseBundle,
} from "../export/export-types.js";
import { DrizzleUniverseRepository } from "../universe/universe-repository-drizzle.js";
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

  insertDiaryComment(
    userId: string,
    record: ExportDiaryCommentRecord,
  ): Promise<void>;

  insertTodo(
    userId: string,
    record: ExportTodoPaper,
  ): Promise<void>;

  insertUniverse(
    userId: string,
    record: ExportUniverseBundle,
  ): Promise<void>;

  insertConversation(
    userId: string,
    record: ExportConversationRecord,
  ): Promise<void>;

  insertConversationMessage(
    userId: string,
    record: ExportConversationMessageRecord,
  ): Promise<void>;

  setConversationCurrentHead(
    userId: string,
    conversationId: string,
    currentHeadMessageId: string,
  ): Promise<void>;

  insertConversationContentBlock(
    userId: string,
    record: ExportConversationContentBlockRecord,
  ): Promise<void>;

  insertConversationAttachment(
    userId: string,
    record: ExportConversationAttachmentRecord,
  ): Promise<void>;

  insertConversationProviderCheckpoint(
    userId: string,
    record: ExportConversationProviderCheckpointRecord,
  ): Promise<void>;

  insertMind(
    userId: string,
    record: ExportMindStateRecord,
  ): Promise<void>;

  insertMindDriveSatisfactionEvent(
    userId: string,
    record: ExportMindDriveSatisfactionEventRecord,
  ): Promise<void>;

  insertMindCuriosityResolutionEvent(
    userId: string,
    record: ExportMindCuriosityResolutionEventRecord,
  ): Promise<void>;

  insertMindDistillationWatermark(
    userId: string,
    record: ExportMindDistillationWatermarkRecord,
  ): Promise<void>;

  insertMindSemanticGroupingResult(
    userId: string,
    record: ExportMindSemanticGroupingResultRecord,
  ): Promise<void>;

  insertProjectWorkspace(
    userId: string,
    record: ExportProjectWorkspaceRecord,
  ): Promise<void>;

  insertProject(
    userId: string,
    record: ExportProjectRecord,
  ): Promise<void>;

  insertProjectResource(
    userId: string,
    record: ExportProjectResourceRecord,
  ): Promise<void>;

  insertProjectConversation(
    userId: string,
    record: ExportProjectConversationRecord,
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

const emptyProjects = (): ExportProjectsBundle => ({
  workspaces: [],
  projects: [],
  resources: [],
  conversations: [],
});

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

  async readCurrentState(
    userId: string,
  ): Promise<ImportCurrentState> {
    const [
      diary,
      diaryCommentRows,
      papers,
      allDiary,
      allDiaryCommentIds,
      workspaceRows,
      projectRows,
      resourceRows,
      projectConversationRows,
      mindRows,
      nativeConversationRows,
      nativeMessageRows,
      nativeContentRows,
      nativeAttachmentRows,
      allWorkspaceIds,
      allProjectIds,
      allResourceIds,
      allMindIds,
      allConversationIds,
      allMessageIds,
      allContentIds,
      allAttachmentIds,
    ] = await Promise.all([
      this.db
        .select()
        .from(diaryEntries)
        .where(eq(diaryEntries.userId, userId))
        .orderBy(asc(diaryEntries.id)),
      this.db
        .select({
          id: diaryComments.id,
          diaryId: diaryComments.diaryId,
          author: diaryComments.author,
          content: diaryComments.content,
          revision: diaryComments.revision,
          createdAt: diaryComments.createdAt,
          updatedAt: diaryComments.updatedAt,
        })
        .from(diaryComments)
        .where(eq(diaryComments.userId, userId))
        .orderBy(
          asc(diaryComments.diaryId),
          asc(diaryComments.createdAt),
          asc(diaryComments.id),
        ),
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
      this.db
        .select({ id: diaryComments.id })
        .from(diaryComments),
      this.db
        .select({
          id: projectWorkspaces.id,
          name: projectWorkspaces.name,
          description: projectWorkspaces.description,
          version: projectWorkspaces.version,
          createdAt: projectWorkspaces.createdAt,
          updatedAt: projectWorkspaces.updatedAt,
        })
        .from(projectWorkspaces)
        .where(eq(projectWorkspaces.userId, userId))
        .orderBy(asc(projectWorkspaces.id)),
      this.db
        .select({
          id: projects.id,
          workspaceId: projects.workspaceId,
          name: projects.name,
          description: projects.description,
          version: projects.version,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
        })
        .from(projects)
        .where(eq(projects.userId, userId))
        .orderBy(asc(projects.id)),
      this.db
        .select({
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
        })
        .from(projectResources)
        .where(eq(projectResources.userId, userId))
        .orderBy(asc(projectResources.id)),
      this.db
        .select({
          projectId: projectConversations.projectId,
          conversationId: projectConversations.conversationId,
          addedAt: projectConversations.addedAt,
        })
        .from(projectConversations)
        .where(eq(projectConversations.userId, userId))
        .orderBy(
          asc(projectConversations.projectId),
          asc(projectConversations.conversationId),
        ),
      this.db
        .select({
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
        })
        .from(runtimeSubjectStates)
        .where(eq(runtimeSubjectStates.userId, userId))
        .orderBy(asc(runtimeSubjectStates.id)),
      this.db
        .select({
          id: conversations.id,
          title: conversations.title,
          lifecycleStatus: conversations.lifecycleStatus,
          currentHeadMessageId: conversations.currentHeadMessageId,
          defaultModel: conversations.defaultModel,
          providerMetadata: conversations.providerMetadata,
          createdAt: conversations.createdAt,
          updatedAt: conversations.updatedAt,
          archivedAt: conversations.archivedAt,
        })
        .from(conversations)
        .where(and(
          eq(conversations.userId, userId),
          eq(conversations.origin, "native_live"),
          inArray(conversations.lifecycleStatus, ["active", "archived"]),
        ))
        .orderBy(asc(conversations.id)),
      this.db
        .select({
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
        })
        .from(conversationMessages)
        .innerJoin(
          conversations,
          and(
            eq(conversationMessages.conversationId, conversations.id),
            eq(conversationMessages.userId, conversations.userId),
          ),
        )
        .where(and(
          eq(conversations.userId, userId),
          eq(conversations.origin, "native_live"),
          inArray(conversations.lifecycleStatus, ["active", "archived"]),
        ))
        .orderBy(asc(conversationMessages.id)),
      this.db
        .select({
          id: conversationContentBlocks.id,
          messageId: conversationContentBlocks.messageId,
          ordinal: conversationContentBlocks.ordinal,
          kind: conversationContentBlocks.kind,
          rawType: conversationContentBlocks.rawType,
          text: conversationContentBlocks.text,
          payload: conversationContentBlocks.payload,
          createdAt: conversationContentBlocks.createdAt,
        })
        .from(conversationContentBlocks)
        .innerJoin(
          conversationMessages,
          and(
            eq(conversationContentBlocks.messageId, conversationMessages.id),
            eq(conversationContentBlocks.userId, conversationMessages.userId),
          ),
        )
        .innerJoin(
          conversations,
          and(
            eq(conversationMessages.conversationId, conversations.id),
            eq(conversationMessages.userId, conversations.userId),
          ),
        )
        .where(and(
          eq(conversations.userId, userId),
          eq(conversations.origin, "native_live"),
          inArray(conversations.lifecycleStatus, ["active", "archived"]),
        ))
        .orderBy(
          asc(conversationContentBlocks.messageId),
          asc(conversationContentBlocks.ordinal),
          asc(conversationContentBlocks.id),
        ),
      this.db
        .select({
          id: conversationAttachments.id,
          messageId: conversationAttachments.messageId,
          ordinal: conversationAttachments.ordinal,
          sourceAttachmentId: conversationAttachments.sourceAttachmentId,
          name: conversationAttachments.name,
          mimeType: conversationAttachments.mimeType,
          sizeBytes: conversationAttachments.sizeBytes,
          payload: conversationAttachments.payload,
        })
        .from(conversationAttachments)
        .innerJoin(
          conversationMessages,
          and(
            eq(conversationAttachments.messageId, conversationMessages.id),
            eq(conversationAttachments.userId, conversationMessages.userId),
          ),
        )
        .innerJoin(
          conversations,
          and(
            eq(conversationMessages.conversationId, conversations.id),
            eq(conversationMessages.userId, conversations.userId),
          ),
        )
        .where(and(
          eq(conversations.userId, userId),
          eq(conversations.origin, "native_live"),
          inArray(conversations.lifecycleStatus, ["active", "archived"]),
        ))
        .orderBy(
          asc(conversationAttachments.messageId),
          asc(conversationAttachments.ordinal),
          asc(conversationAttachments.id),
        ),
      this.db.select({ id: projectWorkspaces.id }).from(projectWorkspaces),
      this.db.select({ id: projects.id }).from(projects),
      this.db.select({ id: projectResources.id }).from(projectResources),
      this.db.select({ id: runtimeSubjectStates.id }).from(runtimeSubjectStates),
      this.db.select({ id: conversations.id }).from(conversations),
      this.db.select({ id: conversationMessages.id }).from(conversationMessages),
      this.db.select({ id: conversationContentBlocks.id }).from(conversationContentBlocks),
      this.db.select({ id: conversationAttachments.id }).from(conversationAttachments),
    ]);

    const ownedConversationIds = new Set(
      nativeConversationRows.map((row) => row.id),
    );
    const [nativeCheckpointRows, allCheckpointIds] =
      await Promise.all([
        ownedConversationIds.size === 0
          ? Promise.resolve([])
          : this.db.select({
              id: conversationProviderSessionCheckpoints.id,
              conversationId:
                conversationProviderSessionCheckpoints.conversationId,
              canonicalMessageId:
                conversationProviderSessionCheckpoints.canonicalMessageId,
              provider:
                conversationProviderSessionCheckpoints.provider,
              providerSessionId:
                conversationProviderSessionCheckpoints.providerSessionId,
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
                  conversationProviderSessionCheckpoints.conversationId,
                  [...ownedConversationIds],
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
        this.db
          .select({ id: conversationProviderSessionCheckpoints.id })
          .from(conversationProviderSessionCheckpoints),
      ]);

    const [
      driveSatisfactionRows,
      curiosityResolutionRows,
      distillationWatermarkRows,
      semanticGroupingRows,
      allDriveSatisfactionIds,
      allCuriosityResolutionIds,
      allSemanticGroupingRows,
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
      this.db.select({ id: runtimeDriveSatisfactionEvents.id })
        .from(runtimeDriveSatisfactionEvents),
      this.db.select({ id: runtimeCuriosityResolutionEvents.id })
        .from(runtimeCuriosityResolutionEvents),
      this.db.select({
        id: runtimeMindSemanticGroupingRequests.id,
        userId: runtimeMindSemanticGroupingRequests.userId,
        subjectId: runtimeMindSemanticGroupingRequests.subjectId,
        kind: runtimeMindSemanticGroupingRequests.kind,
        queryStateId: runtimeMindSemanticGroupingRequests.queryStateId,
      }).from(runtimeMindSemanticGroupingRequests),
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

    const ownedMessageIds = new Set(
      nativeMessageRows.map((row) => row.id),
    );
    const ownedContentIds = new Set(
      nativeContentRows.map((row) => row.id),
    );
    const ownedAttachmentIds = new Set(
      nativeAttachmentRows.map((row) => row.id),
    );

    const universeRead =
      await new DrizzleUniverseRepository(
        this.db as never,
      ).loadUniverseWeb(userId);
    const universe = universeRead
      ? {
          version: universeRead.version,
          snapshot: universeRead.snapshot,
          diary_sources: universeRead.sources.map((source) => ({
            node_id: source.nodeId,
            diary_id: source.diaryId,
          })),
        }
      : null;

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
      diary_comments: diaryCommentRows.map((row) => ({
        id: row.id,
        diary_id: row.diaryId,
        author: row.author,
        content: row.content,
        revision: row.revision,
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
      mind: mindRows.map((row) => ({
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
      })),
      mind_continuity: {
        drive_satisfaction_events:
          driveSatisfactionRows.map((row) => ({
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
        curiosity_resolution_events:
          curiosityResolutionRows.map((row) => ({
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
        distillation_watermarks:
          distillationWatermarkRows.map((row) => ({
            subject_id: row.subjectId,
            conversation_id: row.conversationId,
            last_source_message_id: row.lastSourceMessageId,
            process_version: row.processVersion,
            updated_at: toIso(row.updatedAt),
          })),
        semantic_grouping_results:
          semanticGroupingRows.map((row) => {
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
      },
      conversations: {
        conversations: nativeConversationRows.map((row) => ({
          id: row.id,
          title: row.title,
          lifecycle_status:
            row.lifecycleStatus as "active" | "archived",
          current_head_message_id: row.currentHeadMessageId,
          default_model: row.defaultModel,
          provider_metadata: row.providerMetadata,
          created_at: toIso(row.createdAt),
          updated_at: toIso(row.updatedAt),
          archived_at: row.archivedAt
            ? toIso(row.archivedAt)
            : null,
        })),
        messages: nativeMessageRows.map((row) => ({
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
          completed_at: row.completedAt
            ? toIso(row.completedAt)
            : null,
          updated_at: toIso(row.updatedAt),
        })),
        content_blocks: nativeContentRows.map((row) => ({
          id: row.id,
          message_id: row.messageId,
          ordinal: row.ordinal,
          kind: row.kind,
          raw_type: row.rawType,
          text: row.text,
          payload: row.payload,
          created_at: toIso(row.createdAt),
        })),
        attachments: nativeAttachmentRows.map((row) => ({
          id: row.id,
          message_id: row.messageId,
          ordinal: row.ordinal,
          source_attachment_id: row.sourceAttachmentId,
          name: row.name,
          mime_type: row.mimeType,
          size_bytes: row.sizeBytes,
          payload: row.payload,
        })),
        provider_checkpoints: nativeCheckpointRows.map((row) => ({
          id: row.id,
          conversation_id: row.conversationId,
          canonical_message_id: row.canonicalMessageId,
          provider: row.provider,
          provider_session_id: row.providerSessionId,
          runtime_metadata: row.runtimeMetadata,
          provider_checkpoint_id: row.providerCheckpointId,
          created_at: toIso(row.createdAt),
        })),
      },
      universe,
      projects: {
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
        conversations: projectConversationRows.map((row) => ({
          project_id: row.projectId,
          conversation_id: row.conversationId,
          added_at: toIso(row.addedAt),
        })),
      },
      foreign_diary_ids: new Set(
        allDiary
          .filter((row) => !diary.some((owned) => owned.id === row.id))
          .map((row) => row.id),
      ),
      foreign_diary_comment_ids: new Set(
        allDiaryCommentIds
          .filter(
            (row) =>
              !diaryCommentRows.some(
                (owned) => owned.id === row.id,
              ),
          )
          .map((row) => row.id),
      ),
      foreign_workspace_ids: new Set(
        allWorkspaceIds
          .filter((row) => !workspaceRows.some((owned) => owned.id === row.id))
          .map((row) => row.id),
      ),
      foreign_project_ids: new Set(
        allProjectIds
          .filter((row) => !projectRows.some((owned) => owned.id === row.id))
          .map((row) => row.id),
      ),
      foreign_project_resource_ids: new Set(
        allResourceIds
          .filter((row) => !resourceRows.some((owned) => owned.id === row.id))
          .map((row) => row.id),
      ),
      foreign_mind_ids: new Set(
        allMindIds
          .filter((row) => !mindRows.some((owned) => owned.id === row.id))
          .map((row) => row.id),
      ),
      foreign_drive_satisfaction_event_ids: new Set(
        allDriveSatisfactionIds
          .filter(
            (row) =>
              !driveSatisfactionRows.some(
                (owned) => owned.id === row.id,
              ),
          )
          .map((row) => row.id),
      ),
      foreign_curiosity_resolution_event_ids: new Set(
        allCuriosityResolutionIds
          .filter(
            (row) =>
              !curiosityResolutionRows.some(
                (owned) => owned.id === row.id,
              ),
          )
          .map((row) => row.id),
      ),
      foreign_semantic_grouping_result_ids: new Set(
        allSemanticGroupingRows
          .filter((row) => row.userId !== userId)
          .map((row) => row.id),
      ),
      occupied_semantic_grouping_keys: new Set(
        allSemanticGroupingRows
          .filter((row) => row.userId === userId)
          .map(
            (row) =>
              `${row.subjectId}:${row.kind}:${row.queryStateId}`,
          ),
      ),
      foreign_conversation_ids: new Set(
        allConversationIds
          .filter((row) => !ownedConversationIds.has(row.id))
          .map((row) => row.id),
      ),
      foreign_conversation_message_ids: new Set(
        allMessageIds
          .filter((row) => !ownedMessageIds.has(row.id))
          .map((row) => row.id),
      ),
      foreign_conversation_content_block_ids: new Set(
        allContentIds
          .filter((row) => !ownedContentIds.has(row.id))
          .map((row) => row.id),
      ),
      foreign_conversation_attachment_ids: new Set(
        allAttachmentIds
          .filter((row) => !ownedAttachmentIds.has(row.id))
          .map((row) => row.id),
      ),
      foreign_conversation_checkpoint_ids: new Set(
        allCheckpointIds
          .filter(
            (row) =>
              !nativeCheckpointRows.some(
                (owned) => owned.id === row.id,
              ),
          )
          .map((row) => row.id),
      ),
      native_live_conversation_ids: ownedConversationIds,
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
        runtimeMetadata: record.runtime_metadata,
        providerCheckpointId: record.provider_checkpoint_id,
        createdAt: new Date(record.created_at),
      });
  }

  async insertMind(
    userId: string,
    record: ExportMindStateRecord,
  ): Promise<void> {
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

  async insertProjectWorkspace(
    userId: string,
    record: ExportProjectWorkspaceRecord,
  ): Promise<void> {
    await this.db.insert(projectWorkspaces).values({
      id: record.id,
      userId,
      name: record.name,
      description: record.description,
      version: record.version,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    });
  }

  async insertProject(
    userId: string,
    record: ExportProjectRecord,
  ): Promise<void> {
    await this.db.insert(projects).values({
      id: record.id,
      userId,
      workspaceId: record.workspace_id,
      name: record.name,
      description: record.description,
      version: record.version,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    });
  }

  async insertProjectResource(
    userId: string,
    record: ExportProjectResourceRecord,
  ): Promise<void> {
    await this.db.insert(projectResources).values({
      id: record.id,
      userId,
      projectId: record.project_id,
      kind: record.kind,
      resourceKey: record.key,
      title: record.title,
      content: record.content,
      metadata: record.metadata,
      version: record.version,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    });
  }

  async insertProjectConversation(
    userId: string,
    record: ExportProjectConversationRecord,
  ): Promise<void> {
    await this.db.insert(projectConversations).values({
      userId,
      projectId: record.project_id,
      conversationId: record.conversation_id,
      addedAt: new Date(record.added_at),
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
      projects: modules.has("projects")
        ? state.projects
        : emptyProjects(),
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
