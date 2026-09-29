import { createOwnerFingerprint } from "../export/owner-fingerprint.js";
import type {
  ExportConversationAttachmentRecord,
  ExportConversationContentBlockRecord,
  ExportConversationMessageRecord,
  ExportConversationProviderCheckpointRecord,
  ExportConversationRecord,
  ExportConversationsBundle,
  ExportDiaryCommentRecord,
  ExportDiaryRecord,
  ExportMindContinuityBundle,
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
import {
  ImportValidationError,
  type ParsedImportPackage,
} from "./import-schema.js";
import { hashCanonical } from "./import-canonical.js";

export type ImportModule =
  | "diary"
  | "diary_comments"
  | "todo"
  | "projects"
  | "mind"
  | "conversations"
  | "universe";

export type ImportClassification =
  | "create"
  | "duplicate"
  | "conflict"
  | "invalid";

export type ImportCounts = {
  create: number;
  duplicate: number;
  conflict: number;
  invalid: number;
};

export type ImportCurrentState = {
  diary: ExportDiaryRecord[];
  diary_comments?: ExportDiaryCommentRecord[];
  todo: ExportTodoPaper[];
  projects?: ExportProjectsBundle;
  mind?: ExportMindStateRecord[];
  mind_continuity?: ExportMindContinuityBundle;
  conversations?: ExportConversationsBundle;
  universe?: ExportUniverseBundle | null;
  foreign_diary_ids?: Set<string>;
  foreign_diary_comment_ids?: Set<string>;
  foreign_workspace_ids?: Set<string>;
  foreign_project_ids?: Set<string>;
  foreign_project_resource_ids?: Set<string>;
  foreign_mind_ids?: Set<string>;
  foreign_drive_satisfaction_event_ids?: Set<string>;
  foreign_curiosity_resolution_event_ids?: Set<string>;
  foreign_semantic_grouping_result_ids?: Set<string>;
  occupied_semantic_grouping_keys?: Set<string>;
  foreign_conversation_ids?: Set<string>;
  foreign_conversation_message_ids?: Set<string>;
  foreign_conversation_content_block_ids?: Set<string>;
  foreign_conversation_attachment_ids?: Set<string>;
  foreign_conversation_checkpoint_ids?: Set<string>;
  native_live_conversation_ids?: Set<string>;
};

export type ImportSummary = {
  diary: ImportCounts;
  diary_comments?: ImportCounts;
  todo: ImportCounts;
  projects?: ImportCounts;
  mind?: ImportCounts;
  conversations?: ImportCounts;
  universe?: ImportCounts;
};

export type ProjectRestoreRecord =
  | {
      entity: "workspace";
      value: ExportProjectWorkspaceRecord;
    }
  | {
      entity: "project";
      value: ExportProjectRecord;
    }
  | {
      entity: "resource";
      value: ExportProjectResourceRecord;
    }
  | {
      entity: "conversation";
      value: ExportProjectConversationRecord;
    };

export type ConversationRestoreRecord =
  | {
      entity: "conversation";
      value: ExportConversationRecord;
    }
  | {
      entity: "message";
      value: ExportConversationMessageRecord;
    }
  | {
      entity: "content_block";
      value: ExportConversationContentBlockRecord;
    }
  | {
      entity: "attachment";
      value: ExportConversationAttachmentRecord;
    }
  | {
      entity: "provider_checkpoint";
      value: ExportConversationProviderCheckpointRecord;
    };

export type MindContinuityRestoreRecord =
  | {
      entity: "drive_satisfaction";
      value: ExportMindDriveSatisfactionEventRecord;
    }
  | {
      entity: "curiosity_resolution";
      value: ExportMindCuriosityResolutionEventRecord;
    }
  | {
      entity: "distillation_watermark";
      value: ExportMindDistillationWatermarkRecord;
    }
  | {
      entity: "semantic_grouping";
      value: ExportMindSemanticGroupingResultRecord;
    };

export type UniverseRestoreRecord = {
  entity: "universe";
  value: ExportUniverseBundle;
};

export type ImportPlanItem = {
  module: ImportModule;
  logical_key: string;
  classification: ImportClassification;
  record:
    | ExportDiaryRecord
    | ExportDiaryCommentRecord
    | ExportTodoPaper
    | ExportMindStateRecord
    | MindContinuityRestoreRecord
    | ProjectRestoreRecord
    | ConversationRestoreRecord
    | UniverseRestoreRecord;
  current_hash: string | null;
};

export type ImportPlan = {
  package_sha256: string;
  preview_fingerprint: string;
  can_execute: boolean;
  summary: ImportSummary;
  items: ImportPlanItem[];
};

const emptyCounts = (): ImportCounts => ({
  create: 0,
  duplicate: 0,
  conflict: 0,
  invalid: 0,
});

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

function classify<
  T extends
    | ExportDiaryRecord
    | ExportDiaryCommentRecord
    | ExportTodoPaper
    | ExportMindStateRecord,
>(
  module: "diary" | "diary_comments" | "todo" | "mind",
  imported: T[],
  current: T[],
  key: (record: T) => string,
): ImportPlanItem[] {
  const occurrences = new Map<string, number>();
  for (const record of imported) {
    const logicalKey = key(record);
    occurrences.set(
      logicalKey,
      (occurrences.get(logicalKey) ?? 0) + 1,
    );
  }

  return imported.map((record) => {
    const logicalKey = key(record);
    const existing = current.find(
      (candidate) => key(candidate) === logicalKey,
    );
    let classification: ImportClassification;

    if ((occurrences.get(logicalKey) ?? 0) > 1) {
      classification = "invalid";
    } else if (!existing) {
      classification = "create";
    } else if (hashCanonical(existing) === hashCanonical(record)) {
      classification = "duplicate";
    } else {
      classification = "conflict";
    }

    return {
      module,
      logical_key: logicalKey,
      classification,
      record,
      current_hash: existing ? hashCanonical(existing) : null,
    };
  });
}

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

function mindContinuityItems(
  imported: ExportMindContinuityBundle,
  current: ImportCurrentState,
  importedMind: ExportMindStateRecord[],
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
      state?.kind !== "drive"
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
      state?.kind !== "curiosity"
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
    const candidateStates = record.candidates.map(
      (candidate) => states.get(String(candidate.stateId)),
    );

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
      queryState?.kind !== record.kind
      || queryState.subject_id !== record.subject_id
      || candidateStates.some(
        (candidate) =>
          candidate === undefined
          || candidate.kind !== record.kind
          || candidate.subject_id !== record.subject_id,
      )
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

function classifyProjectEntity<T>(
  entity: ProjectRestoreRecord["entity"],
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
    } else if (hashCanonical(existing) === hashCanonical(record)) {
      classification = "duplicate";
    } else {
      classification = "conflict";
    }

    return {
      module: "projects" as const,
      logical_key: logicalKey,
      classification,
      record: { entity, value: record } as ProjectRestoreRecord,
      current_hash: existing ? hashCanonical(existing) : null,
    };
  });
}

function classifyConversationEntity<T>(
  entity: ConversationRestoreRecord["entity"],
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
    } else if (hashCanonical(existing) === hashCanonical(record)) {
      classification = "duplicate";
    } else {
      classification = "conflict";
    }

    return {
      module: "conversations" as const,
      logical_key: logicalKey,
      classification,
      record: { entity, value: record } as ConversationRestoreRecord,
      current_hash: existing ? hashCanonical(existing) : null,
    };
  });
}

function conversationItems(
  imported: ExportConversationsBundle,
  current: ImportCurrentState,
): ImportPlanItem[] {
  const currentConversations =
    current.conversations ?? emptyConversations();

  const conversationItems = classifyConversationEntity(
    "conversation",
    imported.conversations,
    currentConversations.conversations,
    (record) => record.id,
  );
  const messageItems = classifyConversationEntity(
    "message",
    imported.messages,
    currentConversations.messages,
    (record) => record.id,
  );
  const blockItems = classifyConversationEntity(
    "content_block",
    imported.content_blocks,
    currentConversations.content_blocks,
    (record) => record.id,
  );
  const attachmentItems = classifyConversationEntity(
    "attachment",
    imported.attachments,
    currentConversations.attachments,
    (record) => record.id,
  );
  const checkpointItems = classifyConversationEntity(
    "provider_checkpoint",
    imported.provider_checkpoints,
    currentConversations.provider_checkpoints,
    (record) =>
      `${record.conversation_id}:${record.canonical_message_id}:${record.provider}`,
  );
  const items = [
    ...conversationItems,
    ...messageItems,
    ...blockItems,
    ...attachmentItems,
    ...checkpointItems,
  ];

  const conversationIds = new Set([
    ...currentConversations.conversations.map((record) => record.id),
    ...imported.conversations.map((record) => record.id),
  ]);
  const messageById = new Map<string, ExportConversationMessageRecord>([
    ...currentConversations.messages.map(
      (record) => [record.id, record] as const,
    ),
    ...imported.messages.map(
      (record) => [record.id, record] as const,
    ),
  ]);

  for (const item of items) {
    if (item.classification !== "create") continue;
    const record = item.record as ConversationRestoreRecord;

    if (
      record.entity === "conversation"
      && current.foreign_conversation_ids?.has(record.value.id)
    ) {
      item.classification = "conflict";
      continue;
    }

    if (record.entity === "conversation") {
      const headId = record.value.current_head_message_id;
      if (headId) {
        const head = messageById.get(headId);
        if (!head || head.conversation_id !== record.value.id) {
          item.classification = "invalid";
        }
      }
      continue;
    }

    if (
      record.entity === "message"
      && current.foreign_conversation_message_ids?.has(record.value.id)
    ) {
      item.classification = "conflict";
      continue;
    }

    if (record.entity === "message") {
      if (!conversationIds.has(record.value.conversation_id)) {
        item.classification = "invalid";
        continue;
      }
      if (record.value.parent_message_id) {
        const parent = messageById.get(record.value.parent_message_id);
        if (
          !parent
          || parent.conversation_id !== record.value.conversation_id
          || parent.id === record.value.id
        ) {
          item.classification = "invalid";
        }
      }
      continue;
    }

    if (
      record.entity === "content_block"
      && current.foreign_conversation_content_block_ids?.has(record.value.id)
    ) {
      item.classification = "conflict";
      continue;
    }
    if (record.entity === "content_block") {
      if (!messageById.has(record.value.message_id)) {
        item.classification = "invalid";
      }
      continue;
    }

    if (
      record.entity === "attachment"
      && current.foreign_conversation_attachment_ids?.has(record.value.id)
    ) {
      item.classification = "conflict";
      continue;
    }
    if (record.entity === "attachment") {
      if (!messageById.has(record.value.message_id)) {
        item.classification = "invalid";
      }
      continue;
    }

    if (record.entity === "provider_checkpoint") {
      if (
        current.foreign_conversation_checkpoint_ids?.has(
          record.value.id,
        )
      ) {
        item.classification = "conflict";
        continue;
      }
      const message = messageById.get(
        record.value.canonical_message_id,
      );
      if (
        !conversationIds.has(record.value.conversation_id)
        || !message
        || message.conversation_id !== record.value.conversation_id
        || message.role !== "assistant"
        || message.status !== "completed"
      ) {
        item.classification = "invalid";
      }
    }
  }

  const importedMessageIds = new Set(
    imported.messages.map((record) => record.id),
  );
  const cycleIds = new Set<string>();
  for (const message of imported.messages) {
    const seen = new Set<string>();
    let currentId: string | null = message.id;
    while (currentId && importedMessageIds.has(currentId)) {
      if (seen.has(currentId)) {
        for (const id of seen) cycleIds.add(id);
        break;
      }
      seen.add(currentId);
      const currentMessage = messageById.get(currentId);
      currentId = currentMessage?.parent_message_id ?? null;
    }
  }
  if (cycleIds.size > 0) {
    for (const item of messageItems) {
      const record = item.record as ConversationRestoreRecord;
      if (
        record.entity === "message"
        && cycleIds.has(record.value.id)
      ) {
        item.classification = "invalid";
      }
    }
  }

  const currentPathKeys = new Map<string, string>();
  for (const message of currentConversations.messages) {
    if (
      message.is_current_path
      && message.current_path_index !== null
    ) {
      currentPathKeys.set(
        `${message.conversation_id}:${message.current_path_index}`,
        message.id,
      );
    }
  }
  const importedPathKeys = new Map<string, string>();
  for (const item of messageItems) {
    const record = (item.record as ConversationRestoreRecord).value as ExportConversationMessageRecord;
    if (
      !record.is_current_path
      || record.current_path_index === null
    ) continue;
    const key = `${record.conversation_id}:${record.current_path_index}`;
    const importedOwner = importedPathKeys.get(key);
    if (importedOwner && importedOwner !== record.id) {
      item.classification = "invalid";
      const previous = messageItems.find(
        (candidate) =>
          (candidate.record as ConversationRestoreRecord).entity === "message"
          && ((candidate.record as ConversationRestoreRecord).value as ExportConversationMessageRecord).id === importedOwner,
      );
      if (previous) previous.classification = "invalid";
    } else {
      importedPathKeys.set(key, record.id);
    }
    const currentOwner = currentPathKeys.get(key);
    if (
      item.classification === "create"
      && currentOwner
      && currentOwner !== record.id
    ) {
      item.classification = "conflict";
    }
  }

  const currentBlockOrdinals = new Map<string, string>(
    currentConversations.content_blocks.map(
      (record) => [
        `${record.message_id}:${record.ordinal}`,
        record.id,
      ] as const,
    ),
  );
  const importedBlockOrdinals = new Map<string, string>();
  for (const item of blockItems) {
    const record = (item.record as ConversationRestoreRecord).value as ExportConversationContentBlockRecord;
    const key = `${record.message_id}:${record.ordinal}`;
    const importedOwner = importedBlockOrdinals.get(key);
    if (importedOwner && importedOwner !== record.id) {
      item.classification = "invalid";
      const previous = blockItems.find(
        (candidate) =>
          (candidate.record as ConversationRestoreRecord).entity === "content_block"
          && ((candidate.record as ConversationRestoreRecord).value as ExportConversationContentBlockRecord).id === importedOwner,
      );
      if (previous) previous.classification = "invalid";
    } else {
      importedBlockOrdinals.set(key, record.id);
    }
    const currentOwner = currentBlockOrdinals.get(key);
    if (
      item.classification === "create"
      && currentOwner
      && currentOwner !== record.id
    ) {
      item.classification = "conflict";
    }
  }

  const currentAttachmentOrdinals = new Map<string, string>(
    currentConversations.attachments.map(
      (record) => [
        `${record.message_id}:${record.ordinal}`,
        record.id,
      ] as const,
    ),
  );
  const importedAttachmentOrdinals = new Map<string, string>();
  for (const item of attachmentItems) {
    const record = (item.record as ConversationRestoreRecord).value as ExportConversationAttachmentRecord;
    const key = `${record.message_id}:${record.ordinal}`;
    const importedOwner = importedAttachmentOrdinals.get(key);
    if (importedOwner && importedOwner !== record.id) {
      item.classification = "invalid";
      const previous = attachmentItems.find(
        (candidate) =>
          (candidate.record as ConversationRestoreRecord).entity === "attachment"
          && ((candidate.record as ConversationRestoreRecord).value as ExportConversationAttachmentRecord).id === importedOwner,
      );
      if (previous) previous.classification = "invalid";
    } else {
      importedAttachmentOrdinals.set(key, record.id);
    }
    const currentOwner = currentAttachmentOrdinals.get(key);
    if (
      item.classification === "create"
      && currentOwner
      && currentOwner !== record.id
    ) {
      item.classification = "conflict";
    }
  }

  const currentCheckpointIds = new Set(
    currentConversations.provider_checkpoints.map(
      (record) => record.id,
    ),
  );
  const importedCheckpointIds = new Map<string, number>();
  for (const record of imported.provider_checkpoints) {
    importedCheckpointIds.set(
      record.id,
      (importedCheckpointIds.get(record.id) ?? 0) + 1,
    );
  }
  for (const item of checkpointItems) {
    const record = (item.record as ConversationRestoreRecord).value as ExportConversationProviderCheckpointRecord;
    if ((importedCheckpointIds.get(record.id) ?? 0) > 1) {
      item.classification = "invalid";
      continue;
    }
    if (
      item.classification === "create"
      && currentCheckpointIds.has(record.id)
    ) {
      item.classification = "conflict";
    }
  }

  return items;
}

function projectItems(
  imported: ExportProjectsBundle,
  current: ImportCurrentState,
  additionalConversationIds: Set<string>,
): ImportPlanItem[] {
  const currentProjects = current.projects ?? emptyProjects();

  // Export v3 historically encoded a backing Workspace plus one or more
  // Projects. The product now has one durable Workspace layer. A backing row
  // that is referenced by a Project is therefore structural metadata only;
  // each old Project becomes the restored Workspace. Backing-only rows are
  // preserved as standalone Workspaces so old packages do not silently lose
  // user-authored containers.
  const referencedBackingIds = new Set(
    imported.projects.map((record) => record.workspace_id),
  );
  const standaloneBackingWorkspaces = imported.workspaces.filter(
    (record) => !referencedBackingIds.has(record.id),
  );

  const items = [
    ...classifyProjectEntity(
      "workspace",
      standaloneBackingWorkspaces,
      currentProjects.workspaces,
      (record) => record.id,
    ),
    ...classifyProjectEntity(
      "project",
      imported.projects,
      currentProjects.projects,
      (record) => record.id,
    ),
    ...classifyProjectEntity(
      "resource",
      imported.resources,
      currentProjects.resources,
      (record) => record.id,
    ),
    ...classifyProjectEntity(
      "conversation",
      imported.conversations,
      currentProjects.conversations,
      (record) =>
        `${record.project_id}:${record.conversation_id}`,
    ),
  ];

  const workspaceIds = new Set([
    ...currentProjects.projects.map((record) => record.id),
    ...currentProjects.workspaces.map((record) => record.id),
    ...standaloneBackingWorkspaces.map((record) => record.id),
    ...imported.projects.map((record) => record.id),
  ]);
  const conversationIds = new Set([
    ...(current.native_live_conversation_ids ?? new Set<string>()),
    ...additionalConversationIds,
  ]);

  for (const item of items) {
    if (item.classification !== "create") continue;
    const record = item.record as ProjectRestoreRecord;

    if (
      record.entity === "workspace"
      && (
        current.foreign_workspace_ids?.has(record.value.id)
        || current.foreign_project_ids?.has(record.value.id)
      )
    ) {
      item.classification = "conflict";
      continue;
    }
    if (
      record.entity === "project"
      && (
        current.foreign_project_ids?.has(record.value.id)
        || current.foreign_workspace_ids?.has(record.value.id)
      )
    ) {
      item.classification = "conflict";
      continue;
    }
    if (
      record.entity === "resource"
      && (
        current.foreign_project_resource_ids?.has(record.value.id)
        || !workspaceIds.has(record.value.project_id)
      )
    ) {
      item.classification =
        current.foreign_project_resource_ids?.has(record.value.id)
          ? "conflict"
          : "invalid";
      continue;
    }
    if (
      record.entity === "conversation"
      && (
        !workspaceIds.has(record.value.project_id)
        || !conversationIds.has(record.value.conversation_id)
      )
    ) {
      item.classification = "invalid";
    }
  }

  return items;
}

function summarize(
  items: ImportPlanItem[],
  includeDiaryComments: boolean,
  includeProjects: boolean,
  includeMind: boolean,
  includeConversations: boolean,
  includeUniverse: boolean,
): ImportSummary {
  const summary: ImportSummary = {
    diary: emptyCounts(),
    ...(includeDiaryComments
      ? { diary_comments: emptyCounts() }
      : {}),
    todo: emptyCounts(),
    ...(includeProjects
      ? { projects: emptyCounts() }
      : {}),
    ...(includeMind
      ? { mind: emptyCounts() }
      : {}),
    ...(includeConversations
      ? { conversations: emptyCounts() }
      : {}),
    ...(includeUniverse
      ? { universe: emptyCounts() }
      : {}),
  };

  for (const item of items) {
    const counts = summary[item.module];
    if (counts) counts[item.classification] += 1;
  }
  return summary;
}

export function buildImportPlan(
  parsed: ParsedImportPackage,
  userId: string,
  current: ImportCurrentState,
): ImportPlan {
  if (
    parsed.document.owner_fingerprint
    !== createOwnerFingerprint(userId)
  ) {
    throw new ImportValidationError(
      "IMPORT_OWNER_MISMATCH",
      "IMPORT_OWNER_MISMATCH",
    );
  }

  const items: ImportPlanItem[] = [];

  if (parsed.document.data.diary) {
    items.push(
      ...classify(
        "diary",
        parsed.document.data.diary,
        current.diary,
        (record) => `id:${record.id}`,
      ),
    );

    for (const item of items.filter(
      (candidate) =>
        candidate.module === "diary"
        && candidate.classification === "create",
    )) {
      if (
        current.foreign_diary_ids?.has(
          (item.record as ExportDiaryRecord).id,
        )
      ) {
        item.classification = "conflict";
      }
    }
  }

  const importedDiaryComments =
    parsed.document.schema_version === 3
      ? parsed.document.data.diary_comments
      : undefined;
  if (importedDiaryComments) {
    const commentItems = classify(
      "diary_comments",
      importedDiaryComments,
      current.diary_comments ?? [],
      (record) => `id:${record.id}`,
    );
    const availableDiaryIds = new Set([
      ...current.diary.map((record) => record.id),
      ...(parsed.document.data.diary ?? [])
        .map((record) => record.id),
    ]);
    for (const item of commentItems) {
      if (item.classification !== "create") continue;
      const record = item.record as ExportDiaryCommentRecord;
      if (
        current.foreign_diary_comment_ids?.has(record.id)
      ) {
        item.classification = "conflict";
      } else if (!availableDiaryIds.has(record.diary_id)) {
        item.classification = "invalid";
      }
    }
    items.push(...commentItems);
  }

  if (parsed.document.data.todo) {
    items.push(
      ...classify(
        "todo",
        parsed.document.data.todo,
        current.todo,
        (record) =>
          `paper:${record.date}:${record.author}`,
      ),
    );
  }

  const importedUniverse =
    parsed.document.schema_version === 3
      ? parsed.document.data.universe
      : undefined;
  if (importedUniverse) {
    const currentUniverse = current.universe ?? null;
    let classification: ImportClassification;
    if (!currentUniverse) {
      classification = "create";
    } else if (
      hashCanonical(currentUniverse)
      === hashCanonical(importedUniverse)
    ) {
      classification = "duplicate";
    } else {
      classification = "conflict";
    }

    if (classification === "create") {
      const availableDiaryIds = new Set([
        ...current.diary.map((record) => record.id),
        ...(parsed.document.data.diary ?? [])
          .map((record) => record.id),
      ]);
      if (
        importedUniverse.diary_sources.some(
          (source) =>
            !availableDiaryIds.has(source.diary_id),
        )
      ) {
        classification = "invalid";
      }
    }

    items.push({
      module: "universe",
      logical_key: "universe",
      classification,
      record: {
        entity: "universe",
        value: importedUniverse,
      } as UniverseRestoreRecord,
      current_hash: currentUniverse
        ? hashCanonical(currentUniverse)
        : null,
    });
  }

  const importedConversations =
    parsed.document.schema_version === 3
      ? parsed.document.data.conversations
      : undefined;
  if (importedConversations) {
    items.push(
      ...conversationItems(importedConversations, current),
    );
  }

  const importedProjects =
    parsed.document.schema_version === 3
      ? parsed.document.data.projects
      : undefined;
  if (importedProjects) {
    items.push(
      ...projectItems(
        importedProjects,
        current,
        new Set(
          importedConversations?.conversations.map(
            (record) => record.id,
          ) ?? [],
        ),
      ),
    );
  }

  const importedMind =
    parsed.document.schema_version === 3
      ? parsed.document.data.mind
      : undefined;
  if (importedMind) {
    const mindItems = classify(
      "mind",
      importedMind,
      current.mind ?? [],
      (record) => `id:${record.id}`,
    );
    for (const item of mindItems) {
      if (item.classification !== "create") continue;
      const record = item.record as ExportMindStateRecord;
      if (current.foreign_mind_ids?.has(record.id)) {
        item.classification = "conflict";
      }
    }
    items.push(...mindItems);
  }

  const importedMindContinuity =
    parsed.document.schema_version === 3
      ? parsed.document.data.mind_continuity
      : undefined;
  if (importedMindContinuity) {
    items.push(
      ...mindContinuityItems(
        importedMindContinuity,
        current,
        importedMind ?? [],
        importedConversations,
      ),
    );
  }

  const summary = summarize(
    items,
    Boolean(importedDiaryComments),
    Boolean(importedProjects),
    Boolean(importedMind || importedMindContinuity),
    Boolean(importedConversations),
    Boolean(importedUniverse),
  );
  const fingerprint = hashCanonical({
    package_sha256: parsed.package_sha256,
    items: items.map(
      ({
        module,
        logical_key,
        classification,
        current_hash,
      }) => ({
        module,
        logical_key,
        classification,
        current_hash,
      }),
    ),
  });

  const hasConflict = items.some(
    (item) =>
      item.classification === "conflict"
      || item.classification === "invalid",
  );
  const hasCreate = items.some(
    (item) => item.classification === "create",
  );

  return {
    package_sha256: parsed.package_sha256,
    preview_fingerprint: fingerprint,
    can_execute: !hasConflict && hasCreate,
    summary,
    items,
  };
}
