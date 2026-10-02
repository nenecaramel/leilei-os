import { randomUUID } from "node:crypto";
import type {
  NativeLiveContentBlockInput,
  NativeLiveConversation,
  NativeLiveMessage,
} from "../../conversation/native-live-conversation-types.js";
import type { MindWriteIntent } from "./mind-intent-parser.js";
import type { ParsedAssistantBlocks } from "./mind-block-parser.js";
import {
  NativeLiveMindLoopService,
  type SubjectStateTransition,
} from "./native-live-mind-loop-service.js";
import type { SubjectStateWrite } from "../subject-state/subject-state-contract.js";
import type { BreathSemanticCandidate } from "../breath/breath-semantic-recall.js";
import type { ContextLineageState } from "../context/context-lineage.js";

export type NativeLiveMindSemanticPlan = {
  manifestId: string;
  assembledAt: string;
  snapshotSequence: number;
  query: string;
  candidates: BreathSemanticCandidate[];
};

export type NativeLiveMindRuntimeBindingOptions = {
  subjectId: string;
  createManifestId?: () => string;
  createStateId?: () => string;
  now?: () => string;
  producerId?: string;
  committerId?: string;
};

export interface NativeLiveMindRuntime {
  prepareUserTurn(input: {
    userId: string;
    conversation: NativeLiveConversation;
    userMessage: NativeLiveMessage;
    userText: string;
    surfaceHeadMessageId: string | null;
    manifestId?: string;
    excludedReferenceIds?: ReadonlySet<string>;
    contextLineage?: ContextLineageState | null;
  }): Promise<string>;

  planSemanticUserTurn?(input: {
    userId: string;
    conversation: NativeLiveConversation;
    userMessage: NativeLiveMessage;
    userText: string;
    surfaceHeadMessageId: string | null;
    manifestId?: string;
    excludedReferenceIds?: ReadonlySet<string>;
    contextLineage?: ContextLineageState | null;
  }): Promise<NativeLiveMindSemanticPlan | null>;

  prepareUserTurnFromSemanticPlan?(input: {
    userId: string;
    conversation: NativeLiveConversation;
    userMessage: NativeLiveMessage;
    userText: string;
    surfaceHeadMessageId: string | null;
    excludedReferenceIds?: ReadonlySet<string>;
    contextLineage?: ContextLineageState | null;
    plan: NativeLiveMindSemanticPlan;
    scores: ReadonlyMap<string, number> | null;
  }): Promise<string>;

  parseAssistantBlocks(
    blocks: readonly NativeLiveContentBlockInput[],
  ): ParsedAssistantBlocks;

  recordAssistantIntents(input: {
    userId: string;
    conversationId: string;
    assistantMessageId: string;
    assistantMessageCreatedAt: string;
    intents: readonly MindWriteIntent[];
    stateIds?: readonly string[];
  }): Promise<SubjectStateWrite[]>;

  reconcileSelectedPath(input: {
    userId: string;
    conversation: NativeLiveConversation;
  }): Promise<SubjectStateTransition[]>;

  recordFinalizedBreathRecall?(input: {
    userId: string;
    manifestId: string;
  }): Promise<string[]>;
}

/**
 * Thin runtime binding for the V1 Mind loop.
 *
 * It keeps subject identity and local ID/time factories out of the conversation
 * orchestrators. A true canonical event sequence can replace messages.length
 * when the event-ledger port is wired; for the current local native/live path,
 * the committed snapshot message count is the deterministic watermark.
 */
export class DefaultNativeLiveMindRuntime implements NativeLiveMindRuntime {
  private readonly subjectId: string;
  private readonly createManifestId: () => string;
  private readonly createStateId: () => string;
  private readonly now: () => string;
  private readonly producerId: string;
  private readonly committerId: string;

  constructor(
    private readonly service: NativeLiveMindLoopService,
    options: NativeLiveMindRuntimeBindingOptions,
  ) {
    this.subjectId = options.subjectId;
    this.createManifestId = options.createManifestId ?? randomUUID;
    this.createStateId = options.createStateId ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
    this.producerId = options.producerId ?? "claude-code";
    this.committerId = options.committerId ?? "leileios-runtime";
  }

  async prepareUserTurn(input: {
    userId: string;
    conversation: NativeLiveConversation;
    userMessage: NativeLiveMessage;
    userText: string;
    surfaceHeadMessageId: string | null;
    manifestId?: string;
    excludedReferenceIds?: ReadonlySet<string>;
    contextLineage?: ContextLineageState | null;
  }): Promise<string> {
    const assembledAt = this.now();
    const assembled = await this.service.prepareTurn({
      manifestId: input.manifestId ?? this.createManifestId(),
      userId: input.userId,
      subjectId: this.subjectId,
      conversation: input.conversation,
      userMessageId: input.userMessage.id,
      userText: input.userText,
      userMessageCreatedAt: input.userMessage.createdAt,
      snapshotSequence: input.conversation.messages.length,
      assembledAt,
      surfaceHeadMessageId: input.surfaceHeadMessageId,
      excludedReferenceIds: input.excludedReferenceIds,
      contextLineage: input.contextLineage,
    });
    return assembled.prompt;
  }

  async planSemanticUserTurn(input: {
    userId: string;
    conversation: NativeLiveConversation;
    userMessage: NativeLiveMessage;
    userText: string;
    surfaceHeadMessageId: string | null;
    manifestId?: string;
    excludedReferenceIds?: ReadonlySet<string>;
    contextLineage?: ContextLineageState | null;
  }): Promise<NativeLiveMindSemanticPlan | null> {
    const assembledAt = this.now();
    const semantic = await this.service.planSemanticRecall({
      userId: input.userId,
      subjectId: this.subjectId,
      conversation: input.conversation,
      userText: input.userText,
      assembledAt,
      surfaceHeadMessageId: input.surfaceHeadMessageId,
      excludedReferenceIds: input.excludedReferenceIds,
      contextLineage: input.contextLineage,
    });
    if (!semantic) return null;

    return {
      manifestId: input.manifestId ?? this.createManifestId(),
      assembledAt,
      snapshotSequence: input.conversation.messages.length,
      query: semantic.query,
      candidates: semantic.candidates,
    };
  }

  async prepareUserTurnFromSemanticPlan(input: {
    userId: string;
    conversation: NativeLiveConversation;
    userMessage: NativeLiveMessage;
    userText: string;
    surfaceHeadMessageId: string | null;
    excludedReferenceIds?: ReadonlySet<string>;
    contextLineage?: ContextLineageState | null;
    plan: NativeLiveMindSemanticPlan;
    scores: ReadonlyMap<string, number> | null;
  }): Promise<string> {
    if (input.plan.query !== input.userText) {
      throw new Error("Semantic scoring query does not match the user turn.");
    }

    const assembled = await this.service.prepareTurn({
      manifestId: input.plan.manifestId,
      userId: input.userId,
      subjectId: this.subjectId,
      conversation: input.conversation,
      userMessageId: input.userMessage.id,
      userText: input.userText,
      userMessageCreatedAt: input.userMessage.createdAt,
      snapshotSequence: input.plan.snapshotSequence,
      assembledAt: input.plan.assembledAt,
      surfaceHeadMessageId: input.surfaceHeadMessageId,
      excludedReferenceIds: input.excludedReferenceIds,
      ...(input.scores ? { semanticScores: input.scores } : {}),
      semanticCandidates: input.plan.candidates,
      contextLineage: input.contextLineage,
    });
    return assembled.prompt;
  }

  parseAssistantBlocks(
    blocks: readonly NativeLiveContentBlockInput[],
  ): ParsedAssistantBlocks {
    return this.service.parseAssistantBlocks(blocks);
  }

  recordAssistantIntents(input: {
    userId: string;
    conversationId: string;
    assistantMessageId: string;
    assistantMessageCreatedAt: string;
    intents: readonly MindWriteIntent[];
    stateIds?: readonly string[];
  }): Promise<SubjectStateWrite[]> {
    if (
      input.stateIds
      && input.stateIds.length !== input.intents.length
    ) {
      throw new Error(
        "Mind stateIds must align one-to-one with assistant intents.",
      );
    }

    let stateIndex = 0;
    const createStateId = input.stateIds
      ? () => input.stateIds![stateIndex++]!
      : this.createStateId;

    return this.service.recordAssistantIntents({
      userId: input.userId,
      subjectId: this.subjectId,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      sourceOccurredAt: input.assistantMessageCreatedAt,
      intents: input.intents,
      createStateId,
      producer: { kind: "model", id: this.producerId },
      committer: { kind: "runtime", id: this.committerId },
      sourceStatus: {
        generationStatus: "committed",
        presentationStatus: "presented",
        pathStatus: "current",
        settlementStatus: "unsettled",
        validityStatus: "valid",
      },
      visibility: "subject_private",
      sensitivity: "normal",
      audience: [this.subjectId],
    });
  }

  reconcileSelectedPath(input: {
    userId: string;
    conversation: NativeLiveConversation;
  }): Promise<SubjectStateTransition[]> {
    return this.service.reconcilePath({
      userId: input.userId,
      subjectId: this.subjectId,
      conversation: input.conversation,
    });
  }

  recordFinalizedBreathRecall(input: {
    userId: string;
    manifestId: string;
  }): Promise<string[]> {
    return this.service.recordFinalizedBreathRecall({
      userId: input.userId,
      subjectId: this.subjectId,
      manifestId: input.manifestId,
    });
  }

}
