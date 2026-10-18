import type { ClaudeCodeRecallReceiptPort } from "./claude-code-recall-receipts.js";
import { createHash, randomUUID } from "node:crypto";
import type { BreathSemanticCandidate } from "../breath/breath-semantic-recall.js";
import { mindSnapshotVersion, snapshotMemories } from "./mind-snapshot-version.js";
import { NativeLiveMindLoopService, type SubjectStateRuntimePort, type MindLoopConfig } from "./native-live-mind-loop-service.js";

export type ClaudeCodeRecallInput = {
  userId: string;
  sessionId: string;
  query: string;
  contextEpoch?: number;
  excludeIds: string[];
  semanticCandidates?: BreathSemanticCandidate[];
  semanticScores?: ReadonlyMap<string, number>;
  receiptMode?: "signed_v1";
  semanticSnapshotVersion?: string;
  snapshotScores?: ReadonlyMap<string, number>;
};

/** Adapter over the canonical Mind loop; only the repository's read capability is given to it. */
export class ClaudeCodeMindRecallService {
  private readonly loop: NativeLiveMindLoopService;
  constructor(
    private readonly reader: Pick<SubjectStateRuntimePort, "list"> & {
      searchGlobalRecallCandidates?: (input: {userId: string; subjectId: string; query: string; excludeIds: readonly string[]}) => Promise<import("../subject-state/subject-state-contract.js").SubjectStateWrite[]>;
    },
    private readonly config: MindLoopConfig,
    private readonly subjectId: string,
    private readonly receipts: ClaudeCodeRecallReceiptPort,
  ) {
    const forbidden = async (): Promise<never> => { throw new Error("Read-only Mind adapter cannot write."); };
    // Each external prompt is a fresh retrieval, including rewind/resend. Keep
    // shared scoring weights; only disable the same-context cooldown exclusion.
    this.loop = new NativeLiveMindLoopService({
      list: input => reader.list(input), append: forbidden,
      transition: forbidden, saveContextManifest: forbidden,
    }, {...config, breathCooldownHours: 0, breathLimit: Math.min(2, config.breathLimit)});
  }

  /** Fully authenticated, bounded pages; the caller retries if version changes. */
  async snapshot(input: {userId: string; offset: number}) {
    const states = await this.reader.list({
      userId: input.userId, subjectId: this.subjectId,
      conversationId: "claude-code:mind-snapshot", globalOnly: true,
    });
    const memories = snapshotMemories(states);
    const version = mindSnapshotVersion(states);
    if (memories.length > 30_000) throw new Error("Mind snapshot capacity exceeded.");
    const page = memories.slice(input.offset, input.offset + 128);
    return {version, total: memories.length, memories: page,
      next_offset: input.offset + page.length < memories.length ? input.offset + page.length : null};
  }

  async recall(input: ClaudeCodeRecallInput) {
    const now = new Date().toISOString();
    // Indexed discovery runs inside Railway only when the repository supports
    // it. Tests/in-memory readers retain the existing read-only loop.
    const boundedStates = this.reader.searchGlobalRecallCandidates
      ? await this.reader.searchGlobalRecallCandidates({
          userId: input.userId, subjectId: this.subjectId,
          query: input.query, excludeIds: input.excludeIds,
        })
      : null;
    const loop = boundedStates === null ? this.loop : new NativeLiveMindLoopService({
      list: async () => boundedStates,
      append: async () => { throw new Error("Read-only Mind adapter."); },
      transition: async () => { throw new Error("Read-only Mind adapter."); },
      saveContextManifest: async () => { throw new Error("Read-only Mind adapter."); },
    }, {...this.config, breathCooldownHours: 0, breathLimit: Math.min(2, this.config.breathLimit)});
    const result = await loop.readOnlyRecall({
      manifestId: randomUUID(), userId: input.userId, subjectId: this.subjectId,
      conversation: {
        id: `claude-code:${input.sessionId}`, userId: input.userId,
        title: null, lifecycleStatus: "active", currentHeadMessageId: null,
        createdAt: now, updatedAt: now, messages: [],
      },
      userMessageId: randomUUID(), userText: input.query,
      snapshotSequence: 0, assembledAt: now,
      contextLineage: { epoch: input.contextEpoch ?? 0, seenStateIds: input.excludeIds },
      semanticCandidates: input.semanticCandidates, semanticScores: input.semanticScores,
      semanticSnapshotVersion: input.semanticSnapshotVersion,
      snapshotScores: input.snapshotScores,
    });
    const context = result.assembled.contextData;
    const receiptInput = {
      userId: input.userId, subjectId: this.subjectId, conversationId: `claude-code:${input.sessionId}`,
      contextEpoch: input.contextEpoch ?? 0, stateIds: result.assembled.breathStateIds,
      contextSha256: createHash("sha256").update(context).digest("hex"), recalledAt: now,
    };
    const receipt = !context
      ? {}
      : input.receiptMode === "signed_v1"
        ? (
            this.receipts.issueSigned
              ? await this.receipts.issueSigned(receiptInput)
              : (() => { throw new Error("Signed recall receipts unavailable."); })()
          )
        : await this.receipts.create(receiptInput);
    return {
      ...receipt,
      context: result.assembled.contextData,
      memory_ids: result.assembled.breathStateIds,
      semantic_candidates: result.semanticCandidates,
      semantic_mode: result.semanticMode,
      snapshot_version: result.snapshotVersion,
    };
  }
  async confirm(input: {
    userId: string;
    recallId: string;
    contextSha256: string;
    recallToken?: string;
  }) {
    if (input.recallToken) {
      if (!this.receipts.confirmSigned) throw new Error("Signed recall receipts unavailable.");
      return this.receipts.confirmSigned({
        userId: input.userId,
        recallId: input.recallId,
        recallToken: input.recallToken,
        contextSha256: input.contextSha256,
      });
    }
    return this.receipts.confirm(input);
  }

}