import type {
  ExportConversationsBundle,
  ExportMindContinuityBundle,
  ExportMindCuriosityResolutionEventRecord,
  ExportMindDistillationWatermarkRecord,
  ExportMindDriveSatisfactionEventRecord,
  ExportMindSemanticGroupingResultRecord,
  HistoricalMindStateRecord,
} from "../export/export-types.js";
import { hashCanonical } from "./import-canonical.js";
import type {
  ImportClassification,
  ImportCurrentState,
  ImportPlanItem,
  MindContinuityRestoreRecord,
} from "./import-planner.js";

function classifyMindContinuityEntity<T>(
  entity: MindContinuityRestoreRecord["entity"],
  imported: T[],
  current: T[],
  key: (record: T) => string,
): ImportPlanItem[] {
  const occurrences = new Map<string, number>();
  for (const record of imported) {
    const logicalKey = `${entity}:${key(record)}`;
    occurrences.set(
      logicalKey,
      (occurrences.get(logicalKey) ?? 0) + 1,
    );
  }

  return imported.map((record) => {
    const logicalKey = `${entity}:${key(record)}`;
    const existing = current.find(
      (candidate) => key(candidate) === key(record),
    );
    let classification: ImportClassification;
    if ((occurrences.get(logicalKey) ?? 0) > 1) {
      classification = "invalid";
    } else if (!existing) {
      classification = "create";
    } else if (
      hashCanonical(existing) === hashCanonical(record)
    ) {
      classification = "duplicate";
    } else {
      classification = "conflict";
    }
    return {
      module: "mind" as const,
      logical_key: logicalKey,
      classification,
      record: {
        entity,
        value: record,
      } as MindContinuityRestoreRecord,
      current_hash: existing
        ? hashCanonical(existing)
        : null,
    };
  });
}

export function mindContinuityItems(
  imported: ExportMindContinuityBundle,
  current: ImportCurrentState,
  importedMind: HistoricalMindStateRecord[],
  importedConversations: ExportConversationsBundle | undefined,
): ImportPlanItem[] {
  const currentContinuity = current.mind_continuity ?? {
    drive_satisfaction_events: [],
    curiosity_resolution_events: [],
    distillation_watermarks: [],
    semantic_grouping_results: [],
  };
  const driveItems = classifyMindContinuityEntity(
    "drive_satisfaction",
    imported.drive_satisfaction_events,
    currentContinuity.drive_satisfaction_events,
    (record) => record.idempotency_key,
  );
  const curiosityItems = classifyMindContinuityEntity(
    "curiosity_resolution",
    imported.curiosity_resolution_events,
    currentContinuity.curiosity_resolution_events,
    (record) => record.idempotency_key,
  );
  const watermarkItems = classifyMindContinuityEntity(
    "distillation_watermark",
    imported.distillation_watermarks,
    currentContinuity.distillation_watermarks,
    (record) =>
      `${record.subject_id}:${record.conversation_id}`,
  );
  const groupingItems = classifyMindContinuityEntity(
    "semantic_grouping",
    imported.semantic_grouping_results,
    currentContinuity.semantic_grouping_results,
    (record) =>
      `${record.subject_id}:${record.kind}:${record.query_state_id}`,
  );

  // Archive names describe historical events, not current state kinds. State FKs
  // must resolve to owned Memory; never recreate retired states to satisfy them.
  // Grouping candidates are self-contained historical snapshots without a state
  // FK. Their kinds/scores are validated by import-schema, even if a candidate
  // has since been deleted. Only the grouping query has a durable state FK.
  const states = new Map(
    [
      ...(current.mind ?? []),
      ...importedMind,
    ].map((record) => [record.id, record] as const),
  );
  const currentDriveIds = new Set(
    currentContinuity.drive_satisfaction_events
      .map((record) => record.id),
  );
  const currentCuriosityIds = new Set(
    currentContinuity.curiosity_resolution_events
      .map((record) => record.id),
  );
  const currentGroupingIds = new Set(
    currentContinuity.semantic_grouping_results
      .map((record) => record.id),
  );
  const importedDriveIdCounts = new Map<string, number>();
  for (const record of imported.drive_satisfaction_events) {
    importedDriveIdCounts.set(
      record.id,
      (importedDriveIdCounts.get(record.id) ?? 0) + 1,
    );
  }
  const importedCuriosityIdCounts = new Map<string, number>();
  for (const record of imported.curiosity_resolution_events) {
    importedCuriosityIdCounts.set(
      record.id,
      (importedCuriosityIdCounts.get(record.id) ?? 0) + 1,
    );
  }
  const importedGroupingIdCounts = new Map<string, number>();
  for (const record of imported.semantic_grouping_results) {
    importedGroupingIdCounts.set(
      record.id,
      (importedGroupingIdCounts.get(record.id) ?? 0) + 1,
    );
  }
  const conversations = new Set([
    ...(current.conversations?.conversations ?? [])
      .map((record) => record.id),
    ...(importedConversations?.conversations ?? [])
      .map((record) => record.id),
  ]);
  const messages = new Map(
    [
      ...(current.conversations?.messages ?? []),
      ...(importedConversations?.messages ?? []),
    ].map((record) => [record.id, record] as const),
  );
  const blocks = new Map(
    [
      ...(current.conversations?.content_blocks ?? []),
      ...(importedConversations?.content_blocks ?? []),
    ].map((record) => [record.id, record] as const),
  );

  for (const item of driveItems) {
    if (item.classification !== "create") continue;
    const record =
      (item.record as MindContinuityRestoreRecord).value as ExportMindDriveSatisfactionEventRecord;
    const state = states.get(record.drive_state_id);
    const message = messages.get(record.evidence_message_id);
    const block = record.evidence_block_id
      ? blocks.get(record.evidence_block_id)
      : undefined;

    if (
      (importedDriveIdCounts.get(record.id) ?? 0) > 1
    ) {
      item.classification = "invalid";
    } else if (
      current.foreign_drive_satisfaction_event_ids?.has(record.id)
      || currentDriveIds.has(record.id)
    ) {
      item.classification = "conflict";
    } else if (
      state?.kind !== "memory"
      || state.subject_id !== record.subject_id
      || !conversations.has(record.conversation_id)
      || !message
      || message.conversation_id !== record.conversation_id
      || message.status !== "completed"
      || (
        record.evidence_kind === "user_message"
        && message.role !== "user"
      )
      || (
        record.evidence_kind === "assistant_message"
        && message.role !== "assistant"
      )
      || (
        record.evidence_kind === "tool_result"
        && (
          !block
          || block.message_id !== record.evidence_message_id
          || block.kind !== "tool_result"
        )
      )
    ) {
      item.classification = "invalid";
    }
  }

  for (const item of curiosityItems) {
    if (item.classification !== "create") continue;
    const record =
      (item.record as MindContinuityRestoreRecord).value as ExportMindCuriosityResolutionEventRecord;
    const state = states.get(record.curiosity_state_id);
    const message = messages.get(
      record.requested_resolution_source_id,
    );

    if (
      (importedCuriosityIdCounts.get(record.id) ?? 0) > 1
    ) {
      item.classification = "invalid";
    } else if (
      current.foreign_curiosity_resolution_event_ids?.has(record.id)
      || currentCuriosityIds.has(record.id)
    ) {
      item.classification = "conflict";
    } else if (
      state?.kind !== "memory"
      || state.subject_id !== record.subject_id
      || !conversations.has(record.conversation_id)
      || !message
      || message.conversation_id !== record.conversation_id
    ) {
      item.classification = "invalid";
    }
  }

  for (const item of watermarkItems) {
    if (item.classification !== "create") continue;
    const record =
      (item.record as MindContinuityRestoreRecord).value as ExportMindDistillationWatermarkRecord;
    const message = messages.get(record.last_source_message_id);
    if (
      !conversations.has(record.conversation_id)
      || !message
      || message.conversation_id !== record.conversation_id
    ) {
      item.classification = "invalid";
    }
  }

  for (const item of groupingItems) {
    if (item.classification !== "create") continue;
    const record =
      (item.record as MindContinuityRestoreRecord).value as ExportMindSemanticGroupingResultRecord;
    const queryState = states.get(record.query_state_id);

    if (
      (importedGroupingIdCounts.get(record.id) ?? 0) > 1
    ) {
      item.classification = "invalid";
    } else if (
      current.foreign_semantic_grouping_result_ids?.has(record.id)
      || currentGroupingIds.has(record.id)
      || current.occupied_semantic_grouping_keys?.has(
        `${record.subject_id}:${record.kind}:${record.query_state_id}`,
      )
    ) {
      item.classification = "conflict";
    } else if (
      queryState?.kind !== "memory"
      || queryState.subject_id !== record.subject_id
    ) {
      item.classification = "invalid";
    }
  }

  return [
    ...driveItems,
    ...curiosityItems,
    ...watermarkItems,
    ...groupingItems,
  ];
}

