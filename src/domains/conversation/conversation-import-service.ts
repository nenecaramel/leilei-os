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
  type StagedConversationUpload,
} from "./conversation-import-file.js";
import {
  detectConversationProviderParser,
} from "./conversation-provider-registry.js";
import type { ConversationImportRepository } from "./conversation-import-repository.js";

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
    const run = await this.repository.createPreviewRun({
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
