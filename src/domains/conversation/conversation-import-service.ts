import { hashCanonical } from "../import/import-canonical.js";
import {
  buildConversationMergePlan,
  type ConversationMergeSummary,
  type CurrentConversationState,
} from "./conversation-merge-planner.js";
import type { ConversationProviderWarning } from "./conversation-types.js";
import type { ConversationArchiveStateRepository } from "./conversation-state-repository.js";
import {
  encodeRawConversationSource,
  readTopLevelConversationObjects,
  stageConversationUpload,
  stageStoredConversationSource,
  type StagedConversationUpload,
} from "./conversation-import-file.js";
import {
  detectConversationProviderParser,
} from "./conversation-provider-registry.js";
import type { ConversationImportRepository } from "./conversation-import-repository.js";
import type { ConversationImportExecutor } from "./conversation-import-executor.js";
import {
  applyConversationExclusions,
  type ConversationExclusionSummary,
} from "./conversation-exclusions.js";
import {
  aggregateConversationImportBatch,
  conversationImportStateKey,
  emptyConversationImportExclusions,
  emptyConversationImportSummary,
  scanConversationImportSource,
  type ConversationImportBatchExecuteItem,
  type ConversationImportBatchExecuteResult,
  type ConversationImportBatchFilePreview,
  type ConversationImportBatchPreview,
} from "./conversation-import-batch.js";

export type ConversationImportExecuteResult = {
  outcome: "executed" | "replayed" | "already_executed";
  import_run_id: string;
  source_id: string;
  provider: "chatgpt" | "claude";
  parser_version: string;
  preview_fingerprint: string;
  summary: ConversationMergeSummary;
  warning_count: number;
  warning_codes: Record<string, number>;
  exclusions: ConversationExclusionSummary;
};

export type ConversationImportPreview = {
  import_run_id: string;
  source_id: string;
  provider: "chatgpt" | "claude";
  parser_version: string;
  filename: string;
  raw_sha256: string;
  raw_bytes: number;
  source_reused: boolean;
  already_executed: boolean;
  preview_fingerprint: string;
  summary: ConversationMergeSummary;
  warning_count: number;
  warning_codes: Record<string, number>;
  exclusions: ConversationExclusionSummary;
};

export class ConversationImportAuthorizationError extends Error {}

function emptyExclusionSummary(): ConversationExclusionSummary {
  return { conversations: 0, messages: 0, branch_roots: 0 };
}

function addExclusionSummary(
  target: ConversationExclusionSummary,
  addition: ConversationExclusionSummary,
): void {
  target.conversations += addition.conversations;
  target.messages += addition.messages;
  target.branch_roots += addition.branch_roots;
}

function importPartFingerprint(
  exclusionFingerprint: string,
  mergeFingerprint: string | null,
): string {
  return hashCanonical({
    exclusionFingerprint,
    mergeFingerprint,
  });
}

function emptySummary(): ConversationMergeSummary {
  return {
    conversations: { create: 0, update: 0, unchanged: 0, stale: 0 },
    messages: { create: 0, update: 0, unchanged: 0, stale: 0, path_changed: 0 },
  };
}

function addSummary(
  target: ConversationMergeSummary,
  addition: ConversationMergeSummary,
): void {
  for (const key of ["create", "update", "unchanged", "stale"] as const) {
    target.conversations[key] += addition.conversations[key];
    target.messages[key] += addition.messages[key];
  }
  target.messages.path_changed += addition.messages.path_changed;
}

function warningCounts(
  target: Map<string, number>,
  warnings: readonly ConversationProviderWarning[],
): void {
  for (const warning of warnings) {
    target.set(warning.code, (target.get(warning.code) ?? 0) + 1);
  }
}

function stateKey(provider: string, sourceConversationId: string): string {
  return `${provider}\u0000${sourceConversationId}`;
}

export class ConversationImportService {
  constructor(
    private readonly repository: ConversationImportRepository,
    private readonly stateRepository: ConversationArchiveStateRepository,
    private readonly executor?: ConversationImportExecutor,
  ) {}

  async preview(
    stream: AsyncIterable<Uint8Array>,
    originalFilename: string,
    userId: string,
  ): Promise<ConversationImportPreview> {
    const user = await this.repository.findUserById(userId);
    if (!user || user.status !== "active") {
      throw new ConversationImportAuthorizationError();
    }

    const upload = await stageConversationUpload(stream, originalFilename);
    try {
      return await this.previewStaged(upload, userId);
    } finally {
      await upload.cleanup();
    }
  }

  async execute(
    runId: string,
    expectedPreviewFingerprint: string,
    userId: string,
  ): Promise<ConversationImportExecuteResult> {
    const user = await this.repository.findUserById(userId);
    if (!user || user.status !== "active") {
      throw new ConversationImportAuthorizationError();
    }
    if (!this.executor) {
      throw Object.assign(new Error("Conversation import execution is not configured."), {
        code: "CONVERSATION_IMPORT_UNAVAILABLE",
      });
    }

    const run = await this.repository.findRunById({ userId, runId });
    if (!run) {
      throw Object.assign(new Error("Conversation import run was not found."), {
        code: "CONVERSATION_IMPORT_RUN_NOT_FOUND",
      });
    }
    if (run.status === "executed") {
      return this.resultFromStoredSummary(
        "replayed",
        run.id,
        run.source,
        run.parserVersion,
        run.previewFingerprint ?? expectedPreviewFingerprint,
        run.summary,
        run.warningCount,
      );
    }
    if (
      !run.previewFingerprint
      || run.previewFingerprint !== expectedPreviewFingerprint
    ) {
      throw Object.assign(new Error("Conversation import preview is stale."), {
        code: "CONVERSATION_IMPORT_PREVIEW_STALE",
      });
    }
    if (run.status !== "processing") {
      throw Object.assign(new Error("Conversation import run is not executable."), {
        code: "CONVERSATION_IMPORT_RUN_NOT_EXECUTABLE",
      });
    }

    const blob = await this.repository.readStoredBlob({
      userId,
      sourceId: run.sourceId,
    });
    if (!blob) {
      throw Object.assign(new Error("Conversation import raw source is unavailable."), {
        code: "CONVERSATION_IMPORT_SOURCE_MISSING",
      });
    }
    const staged = await stageStoredConversationSource({
      data: blob.data,
      encoding: blob.encoding,
      originalFilename: run.source.originalFilename,
      expectedSha256: run.source.rawSha256,
      expectedBytes: run.source.rawBytes,
    });

    try {
      return await this.executor.serializable(async (transaction) => {
        if (!await transaction.lockSource(userId, run.sourceId)) {
          throw Object.assign(new Error("Conversation import source was not found."), {
            code: "CONVERSATION_IMPORT_SOURCE_MISSING",
          });
        }
        const lockedRun = await transaction.lockRun(userId, runId);
        if (!lockedRun) {
          throw Object.assign(new Error("Conversation import run was not found."), {
            code: "CONVERSATION_IMPORT_RUN_NOT_FOUND",
          });
        }
        if (lockedRun.status === "executed") {
          return this.resultFromStoredSummary(
            "replayed",
            lockedRun.id,
            run.source,
            lockedRun.parserVersion,
            lockedRun.previewFingerprint ?? expectedPreviewFingerprint,
            lockedRun.summary,
            lockedRun.warningCount,
          );
        }
        if (
          lockedRun.status !== "processing"
          || lockedRun.previewFingerprint !== expectedPreviewFingerprint
          || lockedRun.parserVersion !== run.parserVersion
        ) {
          throw Object.assign(new Error("Conversation import preview is stale."), {
            code: "CONVERSATION_IMPORT_PREVIEW_STALE",
          });
        }

        const priorExecution = await transaction.findExecutedRun({
          userId,
          sourceId: run.sourceId,
          parserVersion: run.parserVersion,
        });
        if (priorExecution) {
          await transaction.markRunSuperseded({
            userId,
            runId,
            executedRunId: priorExecution.id,
          });
          return this.resultFromStoredSummary(
            "already_executed",
            priorExecution.id,
            run.source,
            run.parserVersion,
            expectedPreviewFingerprint,
            priorExecution.summary,
            run.warningCount,
          );
        }

        const current = await transaction.readMergeState(userId);
        const exclusions = await transaction.readExclusions(userId);
        const currentByKey = new Map<string, CurrentConversationState>(
          current.conversations.map((conversation) => [
            stateKey(conversation.provider, conversation.sourceConversationId),
            conversation,
          ]),
        );
        const summary = emptySummary();
        const exclusionSummary = emptyExclusionSummary();
        const warningCodeCounts = new Map<string, number>();
        const previewParts: Array<{
          sourceConversationId: string;
          fingerprint: string;
        }> = [];
        const seenConversations = new Set<string>();
        let providerInfo: ReturnType<typeof detectConversationProviderParser> | null = null;
        let conversationCount = 0;

        for (const jsonPath of staged.jsonPaths) {
          for await (const value of readTopLevelConversationObjects(jsonPath)) {
            const detected = detectConversationProviderParser(value);
            if (
              detected.provider !== run.source.provider
              || detected.version !== run.parserVersion
            ) {
              throw Object.assign(new Error("Stored Conversation source parser no longer matches its preview."), {
                code: "CONVERSATION_IMPORT_PREVIEW_STALE",
              });
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
            const key = stateKey(
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

            const excluded = applyConversationExclusions(rawConversation, exclusions);
            addExclusionSummary(exclusionSummary, excluded.summary);
            warningCounts(warningCodeCounts, normalized.warnings);
            if (!excluded.conversation) {
              previewParts.push({
                sourceConversationId: rawConversation.sourceConversationId,
                fingerprint: importPartFingerprint(excluded.fingerprint, null),
              });
              continue;
            }

            const existing = currentByKey.get(key);
            const plan = buildConversationMergePlan(
              [excluded.conversation],
              { conversations: existing ? [existing] : [] },
              run.source.rawSha256,
              run.parserVersion,
            );
            addSummary(summary, plan.summary);
            previewParts.push({
              sourceConversationId: rawConversation.sourceConversationId,
              fingerprint: importPartFingerprint(
                excluded.fingerprint,
                plan.previewFingerprint,
              ),
            });
          }
        }

        if (!providerInfo || conversationCount === 0) {
          throw Object.assign(new Error("Conversation export contains no conversations."), {
            code: "CONVERSATION_IMPORT_EMPTY",
          });
        }

        const recomputedFingerprint = hashCanonical({
          provider: providerInfo.provider,
          parserVersion: providerInfo.version,
          sourceSha256: run.source.rawSha256,
          parts: previewParts,
        });
        if (
          recomputedFingerprint !== expectedPreviewFingerprint
          || recomputedFingerprint !== lockedRun.previewFingerprint
        ) {
          throw Object.assign(new Error("Conversation import preview is stale."), {
            code: "CONVERSATION_IMPORT_PREVIEW_STALE",
          });
        }

        // The complete preview fingerprint is verified before the first canonical
        // Conversation write. The stored source is immutable, so a second
        // streaming pass can apply the already-validated merge plan without
        // retaining the full export in memory.
        const applySeenConversations = new Set<string>();
        for (const jsonPath of staged.jsonPaths) {
          for await (const value of readTopLevelConversationObjects(jsonPath)) {
            const detected = detectConversationProviderParser(value);
            if (
              detected.provider !== providerInfo.provider
              || detected.version !== providerInfo.version
            ) {
              throw Object.assign(new Error("Stored Conversation source parser changed during execution."), {
                code: "CONVERSATION_IMPORT_SOURCE_CORRUPT",
              });
            }
            const normalized = detected.parser.normalizeConversation(value);
            const rawConversation = normalized.conversation;
            const key = stateKey(
              rawConversation.provider,
              rawConversation.sourceConversationId,
            );
            if (applySeenConversations.has(key)) {
              throw Object.assign(new Error("Duplicate conversation in stored import source."), {
                code: "CONVERSATION_IMPORT_SOURCE_CORRUPT",
              });
            }
            applySeenConversations.add(key);
            const excluded = applyConversationExclusions(rawConversation, exclusions);
            if (!excluded.conversation) continue;
            const existing = currentByKey.get(key);
            const plan = buildConversationMergePlan(
              [excluded.conversation],
              { conversations: existing ? [existing] : [] },
              run.source.rawSha256,
              run.parserVersion,
            );
            await transaction.applyConversation({
              userId,
              importRunId: runId,
              item: plan.items[0]!,
            });
          }
        }
        if (applySeenConversations.size !== conversationCount) {
          throw Object.assign(new Error("Stored Conversation source changed during execution."), {
            code: "CONVERSATION_IMPORT_SOURCE_CORRUPT",
          });
        }

        const warningCodes = Object.fromEntries(
          [...warningCodeCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
        );
        const warningCount = [...warningCodeCounts.values()]
          .reduce((total, count) => total + count, 0);
        const executionSummary = {
          provider: providerInfo.provider,
          parser_version: providerInfo.version,
          conversations_detected: conversationCount,
          merge: summary,
          warning_codes: warningCodes,
          exclusions: exclusionSummary,
          executed: true,
        };
        await transaction.markRunExecuted({
          userId,
          runId,
          summary: executionSummary,
          warningCount,
        });

        return {
          outcome: "executed" as const,
          import_run_id: runId,
          source_id: run.sourceId,
          provider: run.source.provider,
          parser_version: run.parserVersion,
          preview_fingerprint: recomputedFingerprint,
          summary,
          warning_count: warningCount,
          warning_codes: warningCodes,
          exclusions: exclusionSummary,
        };
      });
    } finally {
      await staged.cleanup();
    }
  }

  async previewBatch(
    runIds: readonly string[],
    userId: string,
  ): Promise<ConversationImportBatchPreview> {
    const user = await this.repository.findUserById(userId);
    if (!user || user.status !== "active") {
      throw new ConversationImportAuthorizationError();
    }
    assertConversationImportBatchRunIds(runIds);

    const current = await this.stateRepository.readMergeState(userId);
    const currentByKey = new Map<string, CurrentConversationState>(
      current.conversations.map((conversation) => [
        conversationImportStateKey(
          conversation.provider,
          conversation.sourceConversationId,
        ),
        conversation,
      ]),
    );
    const exclusions = await this.repository.listExclusions(userId);
    const syntheticSequence = { value: 0 };
    const seenSourceParser = new Map<string, string>();
    const items: ConversationImportBatchFilePreview[] = [];

    for (const [inputIndex, runId] of runIds.entries()) {
      const run = await this.repository.findRunById({ userId, runId });
      if (!run) {
        throw Object.assign(new Error("Conversation import run was not found."), {
          code: "CONVERSATION_IMPORT_RUN_NOT_FOUND",
        });
      }
      if (run.status === "failed") {
        throw Object.assign(new Error("Conversation import run is not executable."), {
          code: "CONVERSATION_IMPORT_RUN_NOT_EXECUTABLE",
        });
      }

      const dedupeKey = `${run.sourceId}\u0000${run.parserVersion}`;
      const firstRunId = seenSourceParser.get(dedupeKey) ?? null;
      if (firstRunId) {
        items.push(batchFilePreview({
          inputIndex,
          run,
          status: "duplicate_in_batch",
          duplicateOfRunId: firstRunId,
          executedRunId: null,
        }));
        continue;
      }
      seenSourceParser.set(dedupeKey, run.id);

      const executed = run.status === "executed"
        ? { id: run.id, summary: run.summary }
        : await this.repository.findExecutedRun({
            userId,
            sourceId: run.sourceId,
            parserVersion: run.parserVersion,
          });
      if (executed) {
        items.push(batchFilePreview({
          inputIndex,
          run,
          status: "already_executed",
          duplicateOfRunId: null,
          executedRunId: executed.id,
        }));
        continue;
      }

      const blob = await this.repository.readStoredBlob({
        userId,
        sourceId: run.sourceId,
      });
      if (!blob) {
        throw Object.assign(new Error("Conversation import raw source is unavailable."), {
          code: "CONVERSATION_IMPORT_SOURCE_MISSING",
        });
      }
      const scan = await scanConversationImportSource({
        source: run.source,
        parserVersion: run.parserVersion,
        blob,
        currentByKey,
        exclusions,
        syntheticSequence,
      });
      items.push({
        ...batchFilePreview({
          inputIndex,
          run,
          status: "pending",
          duplicateOfRunId: null,
          executedRunId: null,
        }),
        preview_fingerprint: scan.previewFingerprint,
        summary: scan.summary,
        warning_count: scan.warningCount,
        warning_codes: scan.warningCodes,
        exclusions: scan.exclusions,
      });
    }

    return aggregateConversationImportBatch(items);
  }

  async executeBatch(
    runIds: readonly string[],
    expectedBatchFingerprint: string,
    userId: string,
  ): Promise<ConversationImportBatchExecuteResult> {
    const user = await this.repository.findUserById(userId);
    if (!user || user.status !== "active") {
      throw new ConversationImportAuthorizationError();
    }
    assertConversationImportBatchRunIds(runIds);
    if (!/^[0-9a-f]{64}$/u.test(expectedBatchFingerprint)) {
      throw Object.assign(new Error("Conversation import batch preview fingerprint is invalid."), {
        code: "CONVERSATION_IMPORT_INVALID_REQUEST",
      });
    }
    if (!this.executor) {
      throw Object.assign(new Error("Conversation import execution is not configured."), {
        code: "CONVERSATION_IMPORT_UNAVAILABLE",
      });
    }

    const resolved = [];
    for (const runId of runIds) {
      const run = await this.repository.findRunById({ userId, runId });
      if (!run) {
        throw Object.assign(new Error("Conversation import run was not found."), {
          code: "CONVERSATION_IMPORT_RUN_NOT_FOUND",
        });
      }
      resolved.push(run);
    }

    return this.executor.serializable(async (transaction) => {
      const lockedRuns = new Map<string, Awaited<ReturnType<typeof transaction.lockRun>>>();
      for (const run of resolved) {
        if (!lockedRuns.has(run.id)) {
          const locked = await transaction.lockRun(userId, run.id);
          if (!locked) {
            throw Object.assign(new Error("Conversation import run was not found."), {
              code: "CONVERSATION_IMPORT_RUN_NOT_FOUND",
            });
          }
          if (locked.status === "failed") {
            throw Object.assign(new Error("Conversation import run is not executable."), {
              code: "CONVERSATION_IMPORT_RUN_NOT_EXECUTABLE",
            });
          }
          lockedRuns.set(run.id, locked);
        }
      }

      const lockedSources = new Set<string>();
      for (const run of resolved) {
        if (lockedSources.has(run.sourceId)) continue;
        if (!await transaction.lockSource(userId, run.sourceId)) {
          throw Object.assign(new Error("Conversation import source was not found."), {
            code: "CONVERSATION_IMPORT_SOURCE_MISSING",
          });
        }
        lockedSources.add(run.sourceId);
      }

      const current = await transaction.readMergeState(userId);
      const currentByKey = new Map<string, CurrentConversationState>(
        current.conversations.map((conversation) => [
          conversationImportStateKey(
            conversation.provider,
            conversation.sourceConversationId,
          ),
          conversation,
        ]),
      );
      const exclusions = await transaction.readExclusions(userId);
      const syntheticSequence = { value: 0 };
      const seenSourceParser = new Map<string, string>();
      const previewItems: ConversationImportBatchFilePreview[] = [];
      const replayedBatchRuns = new Set<string>();

      for (const [inputIndex, run] of resolved.entries()) {
        const locked = lockedRuns.get(run.id)!;
        const dedupeKey = `${run.sourceId}\u0000${run.parserVersion}`;
        const firstRunId = seenSourceParser.get(dedupeKey) ?? null;
        if (firstRunId) {
          previewItems.push(batchFilePreview({
            inputIndex,
            run,
            status: "duplicate_in_batch",
            duplicateOfRunId: firstRunId,
            executedRunId: null,
          }));
          continue;
        }
        seenSourceParser.set(dedupeKey, run.id);

        const storedBatchFingerprint =
          typeof locked.summary.batch_fingerprint === "string"
            ? locked.summary.batch_fingerprint
            : null;
        const storedBatchPreviewFingerprint =
          typeof locked.summary.batch_preview_fingerprint === "string"
            ? locked.summary.batch_preview_fingerprint
            : null;
        if (
          locked.status === "executed"
          && storedBatchFingerprint === expectedBatchFingerprint
          && storedBatchPreviewFingerprint
        ) {
          replayedBatchRuns.add(run.id);
          previewItems.push({
            ...batchFilePreview({
              inputIndex,
              run,
              status: "pending",
              duplicateOfRunId: null,
              executedRunId: null,
            }),
            preview_fingerprint: storedBatchPreviewFingerprint,
            summary: readStoredMergeSummary(locked.summary),
            warning_count: locked.warningCount,
            warning_codes: readStoredWarningCodes(locked.summary),
            exclusions: readStoredExclusions(locked.summary),
          });
          continue;
        }

        const executed = locked.status === "executed"
          ? { id: locked.id, summary: locked.summary }
          : await transaction.findExecutedRun({
              userId,
              sourceId: run.sourceId,
              parserVersion: run.parserVersion,
            });
        if (executed) {
          previewItems.push(batchFilePreview({
            inputIndex,
            run,
            status: "already_executed",
            duplicateOfRunId: null,
            executedRunId: executed.id,
          }));
          continue;
        }

        const blob = await transaction.readStoredBlob({
          userId,
          sourceId: run.sourceId,
        });
        if (!blob) {
          throw Object.assign(new Error("Conversation import raw source is unavailable."), {
            code: "CONVERSATION_IMPORT_SOURCE_MISSING",
          });
        }
        const scan = await scanConversationImportSource({
          source: run.source,
          parserVersion: run.parserVersion,
          blob,
          currentByKey,
          exclusions,
          syntheticSequence,
        });
        previewItems.push({
          ...batchFilePreview({
            inputIndex,
            run,
            status: "pending",
            duplicateOfRunId: null,
            executedRunId: null,
          }),
          preview_fingerprint: scan.previewFingerprint,
          summary: scan.summary,
          warning_count: scan.warningCount,
          warning_codes: scan.warningCodes,
          exclusions: scan.exclusions,
        });
      }

      const preview = aggregateConversationImportBatch(previewItems);
      if (preview.batch_fingerprint !== expectedBatchFingerprint) {
        throw Object.assign(new Error("Conversation import batch preview is stale."), {
          code: "CONVERSATION_IMPORT_BATCH_PREVIEW_STALE",
        });
      }

      const executedByRunId = new Map<string, string>();
      const outputItems: ConversationImportBatchExecuteItem[] = [];

      for (const item of preview.items) {
        if (item.status === "duplicate_in_batch") continue;
        const run = resolved[item.input_index]!;
        const locked = lockedRuns.get(run.id)!;

        if (item.status === "already_executed") {
          const executedRunId = item.executed_run_id!;
          executedByRunId.set(run.id, executedRunId);
          outputItems.push({
            input_index: item.input_index,
            import_run_id: run.id,
            source_id: run.sourceId,
            outcome: "already_executed",
            executed_run_id: executedRunId,
          });
          continue;
        }

        if (replayedBatchRuns.has(run.id)) {
          executedByRunId.set(run.id, run.id);
          outputItems.push({
            input_index: item.input_index,
            import_run_id: run.id,
            source_id: run.sourceId,
            outcome: "already_executed",
            executed_run_id: run.id,
          });
          continue;
        }

        const actual = await transaction.readMergeState(userId);
        const actualByKey = new Map<string, CurrentConversationState>(
          actual.conversations.map((conversation) => [
            conversationImportStateKey(
              conversation.provider,
              conversation.sourceConversationId,
            ),
            conversation,
          ]),
        );
        const blob = await transaction.readStoredBlob({
          userId,
          sourceId: run.sourceId,
        });
        if (!blob) {
          throw Object.assign(new Error("Conversation import raw source is unavailable."), {
            code: "CONVERSATION_IMPORT_SOURCE_MISSING",
          });
        }
        const applied = await scanConversationImportSource({
          source: run.source,
          parserVersion: run.parserVersion,
          blob,
          currentByKey: actualByKey,
          exclusions,
          syntheticSequence: { value: 0 },
          onPlan: async (planItem) => {
            await transaction.applyConversation({
              userId,
              importRunId: run.id,
              item: planItem,
            });
          },
        });
        if (applied.previewFingerprint !== item.preview_fingerprint) {
          throw Object.assign(new Error("Conversation import batch preview changed before apply."), {
            code: "CONVERSATION_IMPORT_BATCH_PREVIEW_STALE",
          });
        }

        await transaction.markRunExecuted({
          userId,
          runId: run.id,
          summary: {
            provider: run.source.provider,
            parser_version: run.parserVersion,
            conversations_detected: applied.conversationCount,
            merge: applied.summary,
            warning_codes: applied.warningCodes,
            exclusions: applied.exclusions,
            executed: true,
            batch_fingerprint: preview.batch_fingerprint,
            batch_preview_fingerprint: item.preview_fingerprint,
          },
          warningCount: applied.warningCount,
        });
        executedByRunId.set(run.id, run.id);
        outputItems.push({
          input_index: item.input_index,
          import_run_id: run.id,
          source_id: run.sourceId,
          outcome: "executed",
          executed_run_id: run.id,
        });
      }

      for (const item of preview.items) {
        if (item.status !== "duplicate_in_batch") continue;
        const run = resolved[item.input_index]!;
        const duplicateOf = item.duplicate_of_import_run_id!;
        const executedRunId = executedByRunId.get(duplicateOf)
          ?? preview.items.find((candidate) => (
            candidate.import_run_id === duplicateOf
            && candidate.executed_run_id !== null
          ))?.executed_run_id
          ?? duplicateOf;
        outputItems.push({
          input_index: item.input_index,
          import_run_id: run.id,
          source_id: run.sourceId,
          outcome: "duplicate_in_batch",
          executed_run_id: executedRunId,
        });
      }

      outputItems.sort((left, right) => left.input_index - right.input_index);
      const wroteCanonicalData = outputItems.some((item) => item.outcome === "executed");
      return {
        outcome: wroteCanonicalData ? "executed" as const : "already_executed" as const,
        batch_fingerprint: preview.batch_fingerprint,
        files: preview.files,
        summary: preview.summary,
        warning_count: preview.warning_count,
        warning_codes: preview.warning_codes,
        exclusions: preview.exclusions,
        items: outputItems,
      };
    });
  }

  private resultFromStoredSummary(
    outcome: "replayed" | "already_executed",
    runId: string,
    source: { id: string; provider: "chatgpt" | "claude" },
    parserVersion: string,
    previewFingerprint: string,
    storedSummary: Record<string, unknown>,
    fallbackWarningCount: number,
  ): ConversationImportExecuteResult {
    const merge = storedSummary.merge as ConversationMergeSummary | undefined;
    const warningCodes = storedSummary.warning_codes as Record<string, number> | undefined;
    const exclusions = storedSummary.exclusions as ConversationExclusionSummary | undefined;
    return {
      outcome,
      import_run_id: runId,
      source_id: source.id,
      provider: source.provider,
      parser_version: parserVersion,
      preview_fingerprint: previewFingerprint,
      summary: merge ?? emptySummary(),
      warning_count: warningCodes
        ? Object.values(warningCodes).reduce((total, count) => total + count, 0)
        : fallbackWarningCount,
      warning_codes: warningCodes ?? {},
      exclusions: exclusions ?? emptyExclusionSummary(),
    };
  }

  private async previewStaged(
    upload: StagedConversationUpload,
    userId: string,
  ): Promise<ConversationImportPreview> {
    const current = await this.stateRepository.readMergeState(userId);
    const exclusions = await this.repository.listExclusions(userId);
    const currentByKey = new Map<string, CurrentConversationState>(
      current.conversations.map((conversation) => [
        stateKey(conversation.provider, conversation.sourceConversationId),
        conversation,
      ]),
    );

    let providerInfo: ReturnType<typeof detectConversationProviderParser> | null = null;
    const summary = emptySummary();
    const exclusionSummary = emptyExclusionSummary();
    const warningCodeCounts = new Map<string, number>();
    const previewParts: Array<{
      sourceConversationId: string;
      fingerprint: string;
    }> = [];
    const seenConversations = new Set<string>();
    let conversationCount = 0;

    for (const jsonPath of upload.jsonPaths) {
      for await (const value of readTopLevelConversationObjects(jsonPath)) {
        const detected = detectConversationProviderParser(value);
        if (!providerInfo) {
          providerInfo = detected;
        } else if (
          detected.provider !== providerInfo.provider
          || detected.version !== providerInfo.version
        ) {
          throw Object.assign(new Error("Mixed providers are not allowed in one import source."), {
            code: "CONVERSATION_IMPORT_MIXED_PROVIDERS",
          });
        }

        const result = providerInfo.parser.normalizeConversation(value);
        const rawConversation = result.conversation;
        const key = stateKey(
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

        const excluded = applyConversationExclusions(rawConversation, exclusions);
        addExclusionSummary(exclusionSummary, excluded.summary);
        warningCounts(warningCodeCounts, result.warnings);
        if (!excluded.conversation) {
          previewParts.push({
            sourceConversationId: rawConversation.sourceConversationId,
            fingerprint: importPartFingerprint(excluded.fingerprint, null),
          });
          continue;
        }

        const existing = currentByKey.get(key);
        const plan = buildConversationMergePlan(
          [excluded.conversation],
          { conversations: existing ? [existing] : [] },
          upload.rawSha256,
          providerInfo.version,
        );
        addSummary(summary, plan.summary);
        previewParts.push({
          sourceConversationId: rawConversation.sourceConversationId,
          fingerprint: importPartFingerprint(
            excluded.fingerprint,
            plan.previewFingerprint,
          ),
        });
      }
    }

    if (!providerInfo || conversationCount === 0) {
      throw Object.assign(new Error("Conversation export contains no conversations."), {
        code: "CONVERSATION_IMPORT_EMPTY",
      });
    }

    const previewFingerprint = hashCanonical({
      provider: providerInfo.provider,
      parserVersion: providerInfo.version,
      sourceSha256: upload.rawSha256,
      parts: previewParts,
    });

    const existingSource = await this.repository.findSourceBySha(
      userId,
      upload.rawSha256,
    );
    if (existingSource && existingSource.provider !== providerInfo.provider) {
      throw Object.assign(new Error("Stored source provider does not match."), {
        code: "CONVERSATION_IMPORT_PROVIDER_MISMATCH",
      });
    }
    const persisted = existingSource
      ? { source: existingSource, reused: true }
      : await (async () => {
          const stored = await encodeRawConversationSource(upload);
          return this.repository.createOrReuseSourceWithBlob({
            userId,
            provider: providerInfo.provider,
            originalFilename: upload.originalFilename,
            rawSha256: upload.rawSha256,
            rawBytes: upload.rawBytes,
            encoding: stored.encoding,
            data: stored.data,
          });
        })();
    const { source, reused } = persisted;
    const executed = await this.repository.findExecutedRun({
      userId,
      sourceId: source.id,
      parserVersion: providerInfo.version,
    });

    const warningCodes = Object.fromEntries(
      [...warningCodeCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
    const warningCount = [...warningCodeCounts.values()]
      .reduce((total, count) => total + count, 0);
    const summaryRecord = {
      provider: providerInfo.provider,
      parser_version: providerInfo.version,
      conversations_detected: conversationCount,
      merge: summary,
      warning_codes: warningCodes,
      exclusions: exclusionSummary,
    };
    const run = executed ?? await this.repository.createPreviewRun({
      userId,
      sourceId: source.id,
      parserVersion: providerInfo.version,
      previewFingerprint,
      summary: summaryRecord,
      warningCount,
    });

    return {
      import_run_id: run.id,
      source_id: source.id,
      provider: providerInfo.provider,
      parser_version: providerInfo.version,
      filename: upload.originalFilename,
      raw_sha256: upload.rawSha256,
      raw_bytes: upload.rawBytes,
      source_reused: reused,
      already_executed: Boolean(executed),
      preview_fingerprint: previewFingerprint,
      summary,
      warning_count: warningCount,
      warning_codes: warningCodes,
      exclusions: exclusionSummary,
    };
  }
}

function assertConversationImportBatchRunIds(runIds: readonly string[]): void {
  if (
    !Array.isArray(runIds)
    || runIds.length < 1
    || runIds.length > 20
    || runIds.some((runId) => (
      typeof runId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(runId)
    ))
  ) {
    throw Object.assign(new Error("Conversation import batch run ids are invalid."), {
      code: "CONVERSATION_IMPORT_INVALID_REQUEST",
    });
  }
}

function batchFilePreview(input: {
  inputIndex: number;
  run: {
    id: string;
    sourceId: string;
    parserVersion: string;
    source: {
      id: string;
      provider: "chatgpt" | "claude";
      originalFilename: string;
      rawSha256: string;
      rawBytes: number;
    };
  };
  status: ConversationImportBatchFilePreview["status"];
  duplicateOfRunId: string | null;
  executedRunId: string | null;
}): ConversationImportBatchFilePreview {
  return {
    input_index: input.inputIndex,
    import_run_id: input.run.id,
    source_id: input.run.sourceId,
    provider: input.run.source.provider,
    parser_version: input.run.parserVersion,
    filename: input.run.source.originalFilename,
    raw_sha256: input.run.source.rawSha256,
    raw_bytes: input.run.source.rawBytes,
    status: input.status,
    duplicate_of_import_run_id: input.duplicateOfRunId,
    executed_run_id: input.executedRunId,
    preview_fingerprint: null,
    summary: emptyConversationImportSummary(),
    warning_count: 0,
    warning_codes: {},
    exclusions: emptyConversationImportExclusions(),
  };
}


