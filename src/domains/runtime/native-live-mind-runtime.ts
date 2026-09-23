import { randomUUID } from "node:crypto";
import type {
  NativeLiveContentBlockInput,
  NativeLiveConversation,
  NativeLiveMessage,
} from "../conversation/native-live-conversation-types.js";
import type { MindWriteIntent } from "./mind-intent-parser.js";
import type { ParsedAssistantBlocks } from "./mind-block-parser.js";
import {
  NativeLiveMindLoopService,
  type SubjectStateTransition,
} from "./native-live-mind-loop-service.js";
import type { SubjectStateWrite } from "./subject-state-contract.js";
import type { BreathSemanticCandidate } from "./breath-semantic-recall.js";

export type NativeLiveMindSemanticPlan = {
  manifestId: string;
  assembledAt: string;
  snapshotSequence: number;
  query: string;
  candidates: BreathSemanticCandidate[];
};

export interface NativeLiveSubjectEvolutionRuntime {
  runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    limit?: number;
  }): Promise<unknown>;
}

export type NativeLiveMindRuntimeBindingOptions = {
  subjectId: string;
  createManifestId?: () => string;
  createStateId?: () => string;
  now?: () => string;
  producerId?: string;
  committerId?: string;
  thoughtEvolution?: NativeLiveSubjectEvolutionRuntime | null;
  driveEvolution?: NativeLiveSubjectEvolutionRuntime | null;
  curiosityTopicProjection?: NativeLiveSubjectEvolutionRuntime | null;
  topicEvolution?: NativeLiveSubjectEvolutionRuntime | null;
};

export interface NativeLiveMindRuntime {
  prepareUserTurn(input: {
    userId: string;
    conversation: NativeLiveConversation;
    userMessage: NativeLiveMessage;
    userText: string;
    surfaceHeadMessageId: string | null;
  }): Promise<string>;

  planSemanticUserTurn?(input: {
    userId: string;
    conversation: NativeLiveConversation;
    userMessage: NativeLiveMessage;
    userText: string;
    surfaceHeadMessageId: string | null;
  }): Promise<NativeLiveMindSemanticPlan | null>;

  prepareUserTurnFromSemanticPlan?(input: {
    userId: string;
    conversation: NativeLiveConversation;
    userMessage: NativeLiveMessage;
    userText: string;
    surfaceHeadMessageId: string | null;
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
    intents: readonly MindWriteIntent[];
    stateIds?: readonly string[];
  }): Promise<SubjectStateWrite[]>;

  reconcileSelectedPath(input: {
    userId: string;
    conversation: NativeLiveConversation;
  }): Promise<SubjectStateTransition[]>;
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
  private readonly thoughtEvolution: NativeLiveSubjectEvolutionRuntime | null;
  private readonly driveEvolution: NativeLiveSubjectEvolutionRuntime | null;
  private readonly curiosityTopicProjection:
    NativeLiveSubjectEvolutionRuntime | null;
  private readonly topicEvolution: NativeLiveSubjectEvolutionRuntime | null;

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
    this.thoughtEvolution = options.thoughtEvolution ?? null;
    this.driveEvolution = options.driveEvolution ?? null;
    this.curiosityTopicProjection =
      options.curiosityTopicProjection ?? null;
    this.topicEvolution = options.topicEvolution ?? null;
  }

  async prepareUserTurn(input: {
    userId: string;
    conversation: NativeLiveConversation;
    userMessage: NativeLiveMessage;
    userText: string;
    surfaceHeadMessageId: string | null;
  }): Promise<string> {
    const assembledAt = this.now();
    await this.evolveSubjectState(input.userId, assembledAt);
    const assembled = await this.service.prepareTurn({
      manifestId: this.createManifestId(),
      userId: input.userId,
      subjectId: this.subjectId,
      conversation: input.conversation,
      userMessageId: input.userMessage.id,
      userText: input.userText,
      snapshotSequence: input.conversation.messages.length,
      assembledAt,
      surfaceHeadMessageId: input.surfaceHeadMessageId,
    });
    return assembled.prompt;
  }

  async planSemanticUserTurn(input: {
    userId: string;
    conversation: NativeLiveConversation;
    userMessage: NativeLiveMessage;
    userText: string;
    surfaceHeadMessageId: string | null;
  }): Promise<NativeLiveMindSemanticPlan | null> {
    const assembledAt = this.now();
    await this.evolveSubjectState(input.userId, assembledAt);
    const semantic = await this.service.planSemanticRecall({
      userId: input.userId,
      subjectId: this.subjectId,
      conversation: input.conversation,
      userText: input.userText,
      assembledAt,
      surfaceHeadMessageId: input.surfaceHeadMessageId,
    });
    if (!semantic) return null;

    return {
      manifestId: this.createManifestId(),
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
      snapshotSequence: input.plan.snapshotSequence,
      assembledAt: input.plan.assembledAt,
      surfaceHeadMessageId: input.surfaceHeadMessageId,
      ...(input.scores ? { semanticScores: input.scores } : {}),
      semanticCandidates: input.plan.candidates,
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

  private async evolveSubjectState(
    userId: string,
    now: string,
  ): Promise<void> {
    for (const process of [
      this.driveEvolution,
      this.thoughtEvolution,
      this.curiosityTopicProjection,
      this.topicEvolution,
    ]) {
      if (!process) continue;
      try {
        await process.runOnce({
          userId,
          subjectId: this.subjectId,
          now,
        });
      } catch {
        // Derived subject-state maintenance is fail-soft: a Drive/Thought/
        // Curiosity/Topic process failure must not block the user turn or rewrite canonical
        // conversation history.
      }
    }
  }
}
