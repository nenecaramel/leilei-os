import type { ClaudeCodeRecallReceiptPort } from "./claude-code-recall-receipts.js";
import { createHash, randomUUID } from "node:crypto";
import type { BreathSemanticCandidate } from "../breath/breath-semantic-recall.js";
import { NativeLiveMindLoopService, type SubjectStateRuntimePort, type MindLoopConfig } from "./native-live-mind-loop-service.js";

export type ClaudeCodeRecallInput = {
  userId: string;
  sessionId: string;
  query: string;
  contextEpoch?: number;
  excludeIds: string[];
  semanticCandidates?: BreathSemanticCandidate[];
  semanticScores?: ReadonlyMap<string, number>;
};

/** Adapter over the canonical Mind loop; only the repository's read capability is given to it. */
export class ClaudeCodeMindRecallService {
  private readonly loop: NativeLiveMindLoopService;
  constructor(
    reader: Pick<SubjectStateRuntimePort, "list">,
    config: MindLoopConfig,
    private readonly subjectId: string,
    private readonly receipts: ClaudeCodeRecallReceiptPort,
  ) {
    const forbidden = async (): Promise<never> => { throw new Error("Read-only Mind adapter cannot write."); };
    this.loop = new NativeLiveMindLoopService({
      list: input => reader.list(input), append: forbidden,
      transition: forbidden, saveContextManifest: forbidden,
    }, config);
  }

  async recall(input: ClaudeCodeRecallInput) {
    const now = new Date().toISOString();
    const result = await this.loop.readOnlyRecall({
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
    });
    const context = result.assembled.contextData;
    const receipt = context ? await this.receipts.create({
      userId: input.userId, subjectId: this.subjectId, conversationId: `claude-code:${input.sessionId}`,
      contextEpoch: input.contextEpoch ?? 0, stateIds: result.assembled.breathStateIds,
      contextSha256: createHash("sha256").update(context).digest("hex"), recalledAt: now,
    }) : {};
    return {
      ...receipt,
      context: result.assembled.contextData,
      memory_ids: result.assembled.breathStateIds,
      semantic_candidates: result.semanticCandidates,
    };
  }
  async confirm(input: {userId: string; recallId: string; contextSha256: string}) {
    return this.receipts.confirm(input);
  }

}
