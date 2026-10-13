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
  HistoricalMindStateRecord,
  ExportTodoPaper,
  ExportUniverseBundle,
} from "../export/export-types.js";
import {
  ImportValidationError,
  type ParsedImportPackage,
} from "./import-schema.js";
import { hashCanonical } from "./import-canonical.js";
import { conversationItems } from "./import-planner-conversations.js";
import { mindContinuityItems } from "./import-planner-mind-continuity.js";

export type ImportModule =
  | "diary"
  | "diary_comments"
  | "todo"
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
  mind?: HistoricalMindStateRecord[];
  mind_continuity?: ExportMindContinuityBundle;
  conversations?: ExportConversationsBundle;
  universe?: ExportUniverseBundle | null;
  foreign_diary_ids?: Set<string>;
  foreign_diary_comment_ids?: Set<string>;
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
  mind?: ImportCounts;
  conversations?: ImportCounts;
  universe?: ImportCounts;
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
    | HistoricalMindStateRecord
    | MindContinuityRestoreRecord
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

function classify<
  T extends
    | ExportDiaryRecord
    | ExportDiaryCommentRecord
    | ExportTodoPaper
    | HistoricalMindStateRecord,
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

function summarize(
  items: ImportPlanItem[],
  includeDiaryComments: boolean,
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
    parsed.document.schema_version !== 2
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
    parsed.document.schema_version !== 2
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
    parsed.document.schema_version !== 2
      ? parsed.document.data.conversations
      : undefined;
  if (importedConversations) {
    items.push(
      ...conversationItems(importedConversations, current),
    );
  }

  const importedMind =
    parsed.document.schema_version !== 2
      ? parsed.document.data.mind
      : undefined;
  if (importedMind) {
    const retiredKind = importedMind.find(
      (record) =>
        record.kind !== "memory",
    );
    if (retiredKind) {
      throw new ImportValidationError(
        "INVALID_IMPORT_FILE",
        "Import package contains Mind states of a retired kind (thought, drive, curiosity or topic).",
      );
    }
    const mindItems = classify(
      "mind",
      importedMind,
      current.mind ?? [],
      (record) => `id:${record.id}`,
    );
    for (const item of mindItems) {
      if (item.classification !== "create") continue;
      const record = item.record as HistoricalMindStateRecord;
      if (current.foreign_mind_ids?.has(record.id)) {
        item.classification = "conflict";
      }
    }
    items.push(...mindItems);
  }

  const importedMindContinuity =
    parsed.document.schema_version !== 2
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
