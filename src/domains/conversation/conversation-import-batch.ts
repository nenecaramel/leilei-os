import { hashCanonical } from "../import/import-canonical.js";
import {
  buildConversationMergePlan,
  type ConversationMergeConversationItem,
  type ConversationMergeSummary,
  type CurrentConversationMessageState,
  type CurrentConversationState,
} from "./conversation-merge-planner.js";
import {
  readTopLevelConversationObjects,
  stageStoredConversationSource,
} from "./conversation-import-file.js";
import {
  detectConversationProviderParser,
} from "./conversation-provider-registry.js";
import {
  applyConversationExclusions,
  type ConversationExclusionRule,
  type ConversationExclusionSummary,
} from "./conversation-exclusions.js";
import type {
  ConversationStoredBlob,
  ConversationStoredSource,
} from "./conversation-import-repository.js";
import type { ConversationProviderWarning } from "./conversation-types.js";

export type ConversationImportBatchFileStatus =
  | "pending"
  | "already_executed"
  | "duplicate_in_batch";

export type ConversationImportBatchFilePreview = {
  input_index: number;
  import_run_id: string;
  source_id: string;
  provider: "chatgpt" | "claude";
  parser_version: string;
  filename: string;
  raw_sha256: string;
  raw_bytes: number;
  status: ConversationImportBatchFileStatus;
  duplicate_of_import_run_id: string | null;
  executed_run_id: string | null;
  preview_fingerprint: string | null;
  summary: ConversationMergeSummary;
  warning_count: number;
  warning_codes: Record<string, number>;
  exclusions: ConversationExclusionSummary;
};

export type ConversationImportBatchCounts = {
  total: number;
  unique: number;
  duplicate: number;
  already_executed: number;
  pending: number;
};

export type ConversationImportBatchPreview = {
  batch_fingerprint: string;
  files: ConversationImportBatchCounts;
  summary: ConversationMergeSummary;
  warning_count: number;
  warning_codes: Record<string, number>;
  exclusions: ConversationExclusionSummary;
  items: ConversationImportBatchFilePreview[];
};

export type ConversationImportBatchExecuteItem = {
  input_index: number;
  import_run_id: string;
  source_id: string;
  outcome: "executed" | "already_executed" | "duplicate_in_batch";
  executed_run_id: string;
};

export type ConversationImportBatchExecuteResult = {
  outcome: "executed" | "already_executed";
  batch_fingerprint: string;
  files: ConversationImportBatchCounts;
  summary: ConversationMergeSummary;
  warning_count: number;
  warning_codes: Record<string, number>;
  exclusions: ConversationExclusionSummary;
  items: ConversationImportBatchExecuteItem[];
};

export type ConversationImportBatchResolvedRun = {
  inputIndex: number;
  runId: string;
  source: ConversationStoredSource;
  parserVersion: string;
  status: "processing" | "executed";
  executedRunId: string | null;
  duplicateOfRunId: string | null;
};

export type ConversationImportSourceScanResult = {
  previewFingerprint: string;
  summary: ConversationMergeSummary;
  warningCount: number;
  warningCodes: Record<string, number>;
  exclusions: ConversationExclusionSummary;
  conversationCount: number;
};

export function emptyConversationImportSummary(): ConversationMergeSummary {
  return {
    conversations: { create: 0, update: 0, unchanged: 0, stale: 0 },
    messages: { create: 0, update: 0, unchanged: 0, stale: 0, path_changed: 0 },
  };
}

export function addConversationImportSummary(
  target: ConversationMergeSummary,
  addition: ConversationMergeSummary,
): void {
  for (const key of ["create", "update", "unchanged", "stale"] as const) {
    target.conversations[key] += addition.conversations[key];
    target.messages[key] += addition.messages[key];
  }
  target.messages.path_changed += addition.messages.path_changed;
}

export function emptyConversationImportExclusions(): ConversationExclusionSummary {
  return { conversations: 0, messages: 0, branch_roots: 0 };
}

export function addConversationImportExclusions(
  target: ConversationExclusionSummary,
  addition: ConversationExclusionSummary,
): void {
  target.conversations += addition.conversations;
  target.messages += addition.messages;
  target.branch_roots += addition.branch_roots;
}

export function addConversationImportWarningCodes(
  target: Map<string, number>,
  addition: Record<string, number>,
): void {
  for (const [code, count] of Object.entries(addition)) {
    target.set(code, (target.get(code) ?? 0) + count);
  }
}

export function conversationImportStateKey(
  provider: string,
  sourceConversationId: string,
): string {
  return `${provider}\u0000${sourceConversationId}`;
}

function importPartFingerprint(
  exclusionFingerprint: string,
  mergeFingerprint: string | null,
): string {
  return hashCanonical({ exclusionFingerprint, mergeFingerprint });
}

function warningCounts(
  target: Map<string, number>,
  warnings: readonly ConversationProviderWarning[],
): void {
  for (const warning of warnings) {
    target.set(warning.code, (target.get(warning.code) ?? 0) + 1);
  }
}

function cloneMessage(
  message: CurrentConversationMessageState,
): CurrentConversationMessageState {
  return { ...message };
}

function simulateConversationPlan(
  currentByKey: Map<string, CurrentConversationState>,
  item: ConversationMergeConversationItem,
  syntheticSequence: { value: number },
): void {
  const key = conversationImportStateKey(item.provider, item.sourceConversationId);
  const existing = currentByKey.get(key) ?? null;
  const freshAuthoritativePath =
    item.classification !== "stale"
    && item.conversation.currentLeafSourceNodeId !== null;

  const messagesByNode = new Map<string, CurrentConversationMessageState>();
  for (const message of existing?.messages ?? []) {
    messagesByNode.set(message.sourceNodeId, cloneMessage(message));
  }

  if (freshAuthoritativePath) {
    for (const message of messagesByNode.values()) {
      message.isCurrentPath = false;
      message.currentPathIndex = null;
      message.turnIndex = null;
    }
  }

  for (const planned of item.messages) {
    const prior = messagesByNode.get(planned.sourceNodeId) ?? null;
    const imported = planned.message;
    let next: CurrentConversationMessageState;
    if (!prior) {
      syntheticSequence.value += 1;
      next = {
        id: `batch-preview-message-${syntheticSequence.value}`,
        sourceNodeId: planned.sourceNodeId,
        sourceFingerprint: planned.importedFingerprint,
        sourceCreatedAt: imported.sourceCreatedAt,
        sourceUpdatedAt: imported.sourceUpdatedAt,
        isCurrentPath: false,
        currentPathIndex: null,
        turnIndex: null,
      };
    } else if (planned.classification === "update") {
      next = {
        ...prior,
        sourceFingerprint: planned.importedFingerprint,
        sourceCreatedAt: imported.sourceCreatedAt,
        sourceUpdatedAt: imported.sourceUpdatedAt,
      };
    } else {
      next = { ...prior };
    }

    if (freshAuthoritativePath && imported.isCurrentPath) {
      next.isCurrentPath = true;
      next.currentPathIndex = imported.currentPathIndex;
      next.turnIndex = imported.turnIndex;
    }
    messagesByNode.set(planned.sourceNodeId, next);
  }

  let id = existing?.id ?? null;
  if (!id) {
    syntheticSequence.value += 1;
    id = `batch-preview-conversation-${syntheticSequence.value}`;
  }

  const replacesConversationSource =
    item.classification === "create" || item.classification === "update";
  currentByKey.set(key, {
    id,
    provider: item.provider,
    sourceConversationId: item.sourceConversationId,
    sourceFingerprint: replacesConversationSource
      ? item.importedFingerprint
      : existing?.sourceFingerprint ?? item.importedFingerprint,
    sourceCreatedAt: replacesConversationSource
      ? item.conversation.sourceCreatedAt
      : existing?.sourceCreatedAt ?? item.conversation.sourceCreatedAt,
    sourceUpdatedAt: replacesConversationSource
      ? item.conversation.sourceUpdatedAt
      : existing?.sourceUpdatedAt ?? item.conversation.sourceUpdatedAt,
    messages: [...messagesByNode.values()],
  });
}

export async function scanConversationImportSource(input: {
  source: ConversationStoredSource;
  parserVersion: string;
  blob: ConversationStoredBlob;
  currentByKey: Map<string, CurrentConversationState>;
  exclusions: readonly ConversationExclusionRule[];
  syntheticSequence: { value: number };
  onPlan?: (item: ConversationMergeConversationItem) => Promise<void>;
}): Promise<ConversationImportSourceScanResult> {
  const staged = await stageStoredConversationSource({
    data: input.blob.data,
    encoding: input.blob.encoding,
    originalFilename: input.source.originalFilename,
    expectedSha256: input.source.rawSha256,
    expectedBytes: input.source.rawBytes,
  });

  try {
    const summary = emptyConversationImportSummary();
    const exclusionSummary = emptyConversationImportExclusions();
    const warningCodeCounts = new Map<string, number>();
    const previewParts: Array<{ sourceConversationId: string; fingerprint: string }> = [];
    const seenConversations = new Set<string>();
    let conversationCount = 0;
    let providerInfo: ReturnType<typeof detectConversationProviderParser> | null = null;

    for (const jsonPath of staged.jsonPaths) {
      for await (const value of readTopLevelConversationObjects(jsonPath)) {
        const detected = detectConversationProviderParser(value);
        if (
          detected.provider !== input.source.provider
          || detected.version !== input.parserVersion
        ) {
          throw Object.assign(
            new Error("Stored Conversation source parser no longer matches its batch preview."),
            { code: "CONVERSATION_IMPORT_BATCH_PREVIEW_STALE" },
          );
        }
        if (!providerInfo) providerInfo = detected;
        else if (
          providerInfo.provider !== detected.provider
          || providerInfo.version !== detected.version
        ) {
          throw Object.assign(new Error("Mixed providers are not allowed in one import source."), {
            code: "CONVERSATION_IMPORT_MIXED_PROVIDERS",
          });
        }

        const normalized = detected.parser.normalizeConversation(value);
        const rawConversation = normalized.conversation;
        const key = conversationImportStateKey(
          rawConversation.provider,
          rawConversation.sourceConversationId,
        );
        if (seenConversations.has(key)) {
          throw Object.assign(new Error("Duplicate conversation in import source."), {
            code: "CONVERSATION_IMPORT_DUPLICATE_CONVERSATION",
          });
        }
        seenConversations.add(key);
        conversationCount += 1;

        const excluded = applyConversationExclusions(rawConversation, input.exclusions);
        addConversationImportExclusions(exclusionSummary, excluded.summary);
        warningCounts(warningCodeCounts, normalized.warnings);
        if (!excluded.conversation) {
          previewParts.push({
            sourceConversationId: rawConversation.sourceConversationId,
            fingerprint: importPartFingerprint(excluded.fingerprint, null),
          });
          continue;
        }

        const existing = input.currentByKey.get(key);
        const plan = buildConversationMergePlan(
          [excluded.conversation],
          { conversations: existing ? [existing] : [] },
          input.source.rawSha256,
          input.parserVersion,
        );
        const item = plan.items[0]!;
        addConversationImportSummary(summary, plan.summary);
        previewParts.push({
          sourceConversationId: rawConversation.sourceConversationId,
          fingerprint: importPartFingerprint(excluded.fingerprint, plan.previewFingerprint),
        });

        if (input.onPlan) await input.onPlan(item);
        simulateConversationPlan(input.currentByKey, item, input.syntheticSequence);
      }
    }

    if (!providerInfo || conversationCount === 0) {
      throw Object.assign(new Error("Conversation export contains no conversations."), {
        code: "CONVERSATION_IMPORT_EMPTY",
      });
    }

    const warningCodes = Object.fromEntries(
      [...warningCodeCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
    return {
      previewFingerprint: hashCanonical({
        provider: providerInfo.provider,
        parserVersion: providerInfo.version,
        sourceSha256: input.source.rawSha256,
        parts: previewParts,
      }),
      summary,
      warningCount: [...warningCodeCounts.values()].reduce((total, count) => total + count, 0),
      warningCodes,
      exclusions: exclusionSummary,
      conversationCount,
    };
  } finally {
    await staged.cleanup();
  }
}

export function conversationImportBatchFingerprint(
  items: readonly ConversationImportBatchFilePreview[],
): string {
  return hashCanonical({
    version: "conversation-import-batch-v1",
    items: items.map((item) => ({
      input_index: item.input_index,
      import_run_id: item.import_run_id,
      source_id: item.source_id,
      raw_sha256: item.raw_sha256,
      parser_version: item.parser_version,
      status: item.status,
      duplicate_of_import_run_id: item.duplicate_of_import_run_id,
      executed_run_id: item.executed_run_id,
      preview_fingerprint: item.preview_fingerprint,
    })),
  });
}

export function aggregateConversationImportBatch(
  items: ConversationImportBatchFilePreview[],
): ConversationImportBatchPreview {
  const summary = emptyConversationImportSummary();
  const exclusions = emptyConversationImportExclusions();
  const warningCodes = new Map<string, number>();
  for (const item of items) {
    if (item.status !== "pending") continue;
    addConversationImportSummary(summary, item.summary);
    addConversationImportExclusions(exclusions, item.exclusions);
    addConversationImportWarningCodes(warningCodes, item.warning_codes);
  }
  const warning_codes = Object.fromEntries(
    [...warningCodes.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
  const files: ConversationImportBatchCounts = {
    total: items.length,
    unique: items.filter((item) => item.status !== "duplicate_in_batch").length,
    duplicate: items.filter((item) => item.status === "duplicate_in_batch").length,
    already_executed: items.filter((item) => item.status === "already_executed").length,
    pending: items.filter((item) => item.status === "pending").length,
  };
  return {
    batch_fingerprint: conversationImportBatchFingerprint(items),
    files,
    summary,
    warning_count: Object.values(warning_codes).reduce((total, count) => total + count, 0),
    warning_codes,
    exclusions,
    items,
  };
}
