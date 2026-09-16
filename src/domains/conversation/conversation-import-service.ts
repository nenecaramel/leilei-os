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
};

export class ConversationImportAuthorizationError extends Error {}

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
        const currentByKey = new Map<string, CurrentConversationState>(
          current.conversations.map((conversation) => [
            stateKey(conversation.provider, conversation.sourceConversationId),
            conversation,
          ]),
        );
        const summary = emptySummary();
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
            const key = stateKey(
              normalized.conversation.provider,
              normalized.conversation.sourceConversationId,
            );
            if (seenConversations.has(key)) {
              throw Object.assign(new Error("Duplicate conversation in import source."), {
                code: "CONVERSATION_IMPORT_DUPLICATE_CONVERSATION",
              });
            }
            seenConversations.add(key);
            conversationCount += 1;

            const existing = currentByKey.get(key);
            const plan = buildConversationMergePlan(
              [normalized.conversation],
              { conversations: existing ? [existing] : [] },
              run.source.rawSha256,
              run.parserVersion,
            );
            addSummary(summary, plan.summary);
            warningCounts(warningCodeCounts, normalized.warnings);
            previewParts.push({
              sourceConversationId: normalized.conversation.sourceConversationId,
              fingerprint: plan.previewFingerprint,
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
            const key = stateKey(
              normalized.conversation.provider,
              normalized.conversation.sourceConversationId,
            );
            if (applySeenConversations.has(key)) {
              throw Object.assign(new Error("Duplicate conversation in stored import source."), {
                code: "CONVERSATION_IMPORT_SOURCE_CORRUPT",
              });
            }
            applySeenConversations.add(key);
            const existing = currentByKey.get(key);
            const plan = buildConversationMergePlan(
              [normalized.conversation],
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
        };
      });
    } finally {
      await staged.cleanup();
    }
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
    };
  }

  private async previewStaged(
    upload: StagedConversationUpload,
    userId: string,
  ): Promise<ConversationImportPreview> {
    const current = await this.stateRepository.readMergeState(userId);
    const currentByKey = new Map<string, CurrentConversationState>(
      current.conversations.map((conversation) => [
        stateKey(conversation.provider, conversation.sourceConversationId),
        conversation,
      ]),
    );

    let providerInfo: ReturnType<typeof detectConversationProviderParser> | null = null;
    const summary = emptySummary();
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
        const key = stateKey(
          result.conversation.provider,
          result.conversation.sourceConversationId,
        );
        if (seenConversations.has(key)) {
          throw Object.assign(new Error("Duplicate conversation in import source."), {
            code: "CONVERSATION_IMPORT_DUPLICATE_CONVERSATION",
          });
        }
        seenConversations.add(key);
        conversationCount += 1;

        const existing = currentByKey.get(key);
        const plan = buildConversationMergePlan(
          [result.conversation],
          { conversations: existing ? [existing] : [] },
          upload.rawSha256,
          providerInfo.version,
        );
        addSummary(summary, plan.summary);
        warningCounts(warningCodeCounts, result.warnings);
        previewParts.push({
          sourceConversationId: result.conversation.sourceConversationId,
          fingerprint: plan.previewFingerprint,
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
    };
  }
}
