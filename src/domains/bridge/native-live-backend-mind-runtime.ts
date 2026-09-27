import type {
  NativeLiveContentBlockInput,
  NativeLiveConversation,
  NativeLiveMessage,
} from "../conversation/native-live-conversation-types.js";
import type { MindWriteIntent } from "../runtime/mind-intent-parser.js";
import type { ParsedAssistantBlocks } from "../runtime/mind-block-parser.js";
import type {
  NativeLiveMindRuntime,
  NativeLiveMindSemanticPlan,
} from "../runtime/native-live-mind-runtime.js";
import type { NativeLivePreparedTurn } from "./native-live-backend-turn-coordinator.js";
import type {
  SubjectStateSettlementCatchUp,
} from "../runtime/subject-state-settlement-catch-up.js";
import { planReplacementMessagePurge } from "./native-live-replacement-purge.js";

export interface NativeLiveBackendMindConversationReader {
  getConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversation | null>;
}

export interface NativeLiveBackendMindRuntime {
  preparePrompt(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
  }): Promise<string>;

  planSemanticPrompt?(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
  }): Promise<NativeLiveMindSemanticPlan | null>;

  completeSemanticPrompt?(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    plan: NativeLiveMindSemanticPlan;
    scores: ReadonlyMap<string, number> | null;
  }): Promise<string>;

  parseAssistantBlocks(
    blocks: readonly NativeLiveContentBlockInput[],
  ): ParsedAssistantBlocks;

  afterFinalize(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    assistantMessageId: string;
    intents: readonly MindWriteIntent[];
    stateIds?: readonly string[];
  }): Promise<void>;
}

function requirePreparedUserMessage(
  conversation: NativeLiveConversation,
  messageId: string,
): NativeLiveMessage {
  const message = conversation.messages.find(
    (candidate) => candidate.id === messageId,
  );
  if (!message || message.role !== "user") {
    throw new Error("Prepared canonical user message was not found.");
  }
  return message;
}

/**
 * Cross-device adapter between the persisted backend preparation and the
 * existing branch-safe Mind runtime.
 *
 * The backend remains canonical for conversation/Mind state. The prepared
 * runtime prompt is persisted before it is handed to the Mac executor so
 * idempotent prepare replays do not rebuild context from a later state.
 */
export class DefaultNativeLiveBackendMindRuntime
implements NativeLiveBackendMindRuntime {
  constructor(
    private readonly conversations: NativeLiveBackendMindConversationReader,
    private readonly mind: NativeLiveMindRuntime,
    private readonly settlementCatchUp: Pick<
      SubjectStateSettlementCatchUp,
      "run" | "refreshAfterReplacement"
    > | null = null,
  ) {}

  async preparePrompt(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
  }): Promise<string> {
    const conversation = await this.requireConversation(
      input.userId,
      input.preparation.conversationId,
    );
    const userMessage = requirePreparedUserMessage(
      conversation,
      input.preparation.canonicalUserMessageId,
    );

    if (input.preparation.operation === "send") {
      const transitions = await this.mind.reconcileSelectedPath({
        userId: input.userId,
        conversation: {
          ...conversation,
          currentHeadMessageId: userMessage.id,
        },
      });
      await this.runSettlementCatchUp(input.userId, transitions);
    }

    const excludedReferenceIds =
      this.replacementExcludedReferenceIds(
        conversation,
        input.preparation,
      );

    return this.mind.prepareUserTurn({
      userId: input.userId,
      conversation,
      userMessage,
      userText: input.preparation.prompt,
      surfaceHeadMessageId: userMessage.parentMessageId,
      manifestId: input.preparation.prepareId,
      excludedReferenceIds,
    });
  }

  async planSemanticPrompt(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
  }): Promise<NativeLiveMindSemanticPlan | null> {
    if (!this.mind.planSemanticUserTurn) return null;

    const conversation = await this.requireConversation(
      input.userId,
      input.preparation.conversationId,
    );
    const userMessage = requirePreparedUserMessage(
      conversation,
      input.preparation.canonicalUserMessageId,
    );

    if (input.preparation.operation === "send") {
      const transitions = await this.mind.reconcileSelectedPath({
        userId: input.userId,
        conversation: {
          ...conversation,
          currentHeadMessageId: userMessage.id,
        },
      });
      await this.runSettlementCatchUp(input.userId, transitions);
    }

    const excludedReferenceIds =
      this.replacementExcludedReferenceIds(
        conversation,
        input.preparation,
      );

    return this.mind.planSemanticUserTurn({
      userId: input.userId,
      conversation,
      userMessage,
      userText: input.preparation.prompt,
      surfaceHeadMessageId: userMessage.parentMessageId,
      manifestId: input.preparation.prepareId,
      excludedReferenceIds,
    });
  }

  async completeSemanticPrompt(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    plan: NativeLiveMindSemanticPlan;
    scores: ReadonlyMap<string, number> | null;
  }): Promise<string> {
    if (!this.mind.prepareUserTurnFromSemanticPlan) {
      throw new Error("Backend Mind runtime does not support semantic completion.");
    }

    const conversation = await this.requireConversation(
      input.userId,
      input.preparation.conversationId,
    );
    const userMessage = requirePreparedUserMessage(
      conversation,
      input.preparation.canonicalUserMessageId,
    );

    const excludedReferenceIds =
      this.replacementExcludedReferenceIds(
        conversation,
        input.preparation,
      );

    return this.mind.prepareUserTurnFromSemanticPlan({
      userId: input.userId,
      conversation,
      userMessage,
      userText: input.preparation.prompt,
      surfaceHeadMessageId: userMessage.parentMessageId,
      excludedReferenceIds,
      plan: input.plan,
      scores: input.scores,
    });
  }

  private replacementExcludedReferenceIds(
    conversation: NativeLiveConversation,
    preparation: NativeLivePreparedTurn,
  ): ReadonlySet<string> | undefined {
    if (preparation.operation === "send") return undefined;

    const targetUserMessageId =
      preparation.replacementTargetUserMessageId
      ?? (
        preparation.operation === "retry"
          ? preparation.canonicalUserMessageId
          : null
      );
    const plan = planReplacementMessagePurge({
      operation: preparation.operation,
      conversation,
      targetUserMessageId,
    });
    if (!plan) {
      throw new Error(
        "Replacement branch is no longer a valid current-path target.",
      );
    }
    return new Set(plan.messageIds);
  }

  parseAssistantBlocks(
    blocks: readonly NativeLiveContentBlockInput[],
  ): ParsedAssistantBlocks {
    return this.mind.parseAssistantBlocks(blocks);
  }

  async afterFinalize(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    assistantMessageId: string;
    intents: readonly MindWriteIntent[];
    stateIds?: readonly string[];
  }): Promise<void> {
    const conversation = await this.requireConversation(
      input.userId,
      input.preparation.conversationId,
    );

    await this.mind.recordFinalizedBreathRecall?.({
      userId: input.userId,
      manifestId: input.preparation.prepareId,
    });

    if (input.intents.length > 0) {
      await this.mind.recordAssistantIntents({
        userId: input.userId,
        conversationId: input.preparation.conversationId,
        assistantMessageId: input.assistantMessageId,
        intents: input.intents,
        stateIds: input.stateIds,
      });
    }

    if (input.preparation.operation === "send") return;

    await this.mind.reconcileSelectedPath({
      userId: input.userId,
      conversation,
    });
    try {
      await this.settlementCatchUp?.refreshAfterReplacement({
        userId: input.userId,
      });
    } catch {
      // Branch repair is derived and fail-soft after canonical replacement.
    }
  }

  private async runSettlementCatchUp(
    userId: string,
    transitions: Awaited<
      ReturnType<NativeLiveMindRuntime["reconcileSelectedPath"]>
    >,
  ): Promise<void> {
    if (!this.settlementCatchUp || transitions.length === 0) return;
    try {
      await this.settlementCatchUp.run({
        userId,
        transitions,
      });
    } catch {
      // Derived catch-up must never turn a valid foreground preparation into
      // failure. Shared Background Loops remain the eventual fallback.
    }
  }

  private async requireConversation(
    userId: string,
    conversationId: string,
  ): Promise<NativeLiveConversation> {
    const conversation = await this.conversations.getConversation({
      userId,
      conversationId,
    });
    if (!conversation || conversation.lifecycleStatus !== "active") {
      throw new Error("Prepared native/live conversation is not active.");
    }
    return conversation;
  }
}
