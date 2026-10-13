import {
  and,
  asc,
  eq,
  inArray,
} from "drizzle-orm";
import {
  conversationAttachments,
  conversationContentBlocks,
  conversationMessages,
  conversationProviderSessionCheckpoints,
  conversations,
  diaryComments,
  diaryEntries,
  runtimeCuriosityResolutionEvents,
  runtimeDistillationWatermarks,
  runtimeDriveSatisfactionEvents,
  runtimeMindSemanticGroupingRequests,
  runtimeSubjectStates,
  todoEntries,
  todoPapers,
} from "../../database/schema.js";
import {
  DrizzleUniverseRepository,
} from "../universe/universe-repository-drizzle.js";
import type {
  DbExecutor,
} from "./import-repository-types.js";
import type {
  ImportCurrentState,
} from "./import-planner.js";
import {
  assembleImportCurrentState,
} from "./import-current-state-mapping.js";

// Keep query phases on the caller's executor; transaction reads must never
// fall back to a global connection while an import is in progress.
export async function readImportCurrentStateRows(db: DbExecutor, userId: string) {
  const [
    diary,
    diaryCommentRows,
    papers,
    allDiary,
    allDiaryCommentIds,
    mindRows,
    nativeConversationRows,
    nativeMessageRows,
    nativeContentRows,
    nativeAttachmentRows,
    allMindIds,
    allConversationIds,
    allMessageIds,
    allContentIds,
    allAttachmentIds,
  ] = await Promise.all([
    db
      .select()
      .from(diaryEntries)
      .where(eq(diaryEntries.userId, userId))
      .orderBy(asc(diaryEntries.id)),
    db
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
    db
      .select()
      .from(todoPapers)
      .where(eq(todoPapers.userId, userId))
      .orderBy(
        asc(todoPapers.businessDate),
        asc(todoPapers.author),
      ),
    db
      .select({ id: diaryEntries.id })
      .from(diaryEntries),
    db
      .select({ id: diaryComments.id })
      .from(diaryComments),
    db
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
    db
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
    db
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
    db
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
    db
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
    db.select({ id: runtimeSubjectStates.id }).from(runtimeSubjectStates),
    db.select({ id: conversations.id }).from(conversations),
    db.select({ id: conversationMessages.id }).from(conversationMessages),
    db.select({ id: conversationContentBlocks.id }).from(conversationContentBlocks),
    db.select({ id: conversationAttachments.id }).from(conversationAttachments),
  ]);

  const ownedConversationIds = new Set(
    nativeConversationRows.map((row) => row.id),
  );
  const [nativeCheckpointRows, allCheckpointIds] =
    await Promise.all([
      ownedConversationIds.size === 0
        ? Promise.resolve([])
        : db.select({
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
      db
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
    db.select({
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
    db.select({
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
    db.select({
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
    db.select({
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
    db.select({ id: runtimeDriveSatisfactionEvents.id })
      .from(runtimeDriveSatisfactionEvents),
    db.select({ id: runtimeCuriosityResolutionEvents.id })
      .from(runtimeCuriosityResolutionEvents),
    db.select({
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
      : await db
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
      db as never,
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
    diary,
    diaryCommentRows,
    papers,
    allDiary,
    allDiaryCommentIds,
    mindRows,
    nativeConversationRows,
    nativeMessageRows,
    nativeContentRows,
    nativeAttachmentRows,
    allMindIds,
    allConversationIds,
    allMessageIds,
    allContentIds,
    allAttachmentIds,
    ownedConversationIds,
    nativeCheckpointRows,
    allCheckpointIds,
    driveSatisfactionRows,
    curiosityResolutionRows,
    distillationWatermarkRows,
    semanticGroupingRows,
    allDriveSatisfactionIds,
    allCuriosityResolutionIds,
    allSemanticGroupingRows,
    grouped,
    ownedMessageIds,
    ownedContentIds,
    ownedAttachmentIds,
    universe
  };
}

export type ImportCurrentStateRows = Awaited<ReturnType<typeof readImportCurrentStateRows>>;

export async function readImportCurrentState(db: DbExecutor, userId: string): Promise<ImportCurrentState> {
  return assembleImportCurrentState(await readImportCurrentStateRows(db, userId), userId);
}
