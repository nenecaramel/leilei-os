import type { ImportCurrentState } from "./import-planner.js";
import type { ImportCurrentStateRows } from "./import-current-state-reader.js";

const toIso = (value: Date): string => value.toISOString();

// Pure snapshot assembly: no new reads, writes or temporal reinterpretation.
export function assembleImportCurrentState(rows: ImportCurrentStateRows, userId: string): ImportCurrentState {
  const {
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
  } = rows;

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
        effective_working_directory: row.effectiveWorkingDirectory,
        runtime_metadata: row.runtimeMetadata,
        provider_checkpoint_id: row.providerCheckpointId,
        created_at: toIso(row.createdAt),
      })),
    },
    universe,
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
