import type {
  NativeLiveContentBlockInput,
  NativeLiveConversation,
  NativeLiveMessage,
} from "../../conversation/native-live-conversation-types.js";
import type { MindWriteIntent } from "../../runtime/mind/mind-intent-parser.js";
import type { ParsedAssistantBlocks } from "../../runtime/mind/mind-block-parser.js";
import type {
  NativeLiveMindRuntime,
  NativeLiveMindSemanticPlan,
} from "../../runtime/mind/native-live-mind-runtime.js";
import type { NativeLivePreparedTurn } from "../turn/native-live-backend-turn-coordinator.js";
import { planReplacementMessagePurge } from "../turn/native-live-replacement-purge.js";
import type {
  NativeLiveContextLineageReader,
} from "../turn/native-live-context-lineage-repository.js";

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

function isNativeClaudeScheduleCommand(
  preparation: NativeLivePreparedTurn,
): boolean {
  if (preparation.operation !== "send") return false;
  return /^\/(?:schedule|routines)(?:\s|$)/iu
    .test(preparation.prompt);
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
    private readonly contextLineage: NativeLiveContextLineageReader | null = null,
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
      await this.mind.reconcileSelectedPath({
        userId: input.userId,
        conversation: {
          ...conversation,
          currentHeadMessageId: userMessage.id,
        },
      });
    }

    if (isNativeClaudeScheduleCommand(input.preparation)) {
      return input.preparation.prompt;
    }

    const excludedReferenceIds =
      this.replacementExcludedReferenceIds(
        conversation,
        input.preparation,
      );

    const contextLineage = await this.readContextLineage({
      userId: input.userId,
      conversationId: input.preparation.conversationId,
      parentMessageId: userMessage.parentMessageId,
      runtimeMode: input.preparation.runtimeMode,
    });

    return this.mind.prepareUserTurn({
      userId: input.userId,
      conversation,
      userMessage,
      userText: input.preparation.prompt,
      surfaceHeadMessageId: userMessage.parentMessageId,
      manifestId: input.preparation.prepareId,
      excludedReferenceIds,
      contextLineage,
    });
  }

  async planSemanticPrompt(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
  }): Promise<NativeLiveMindSemanticPlan | null> {
    if (isNativeClaudeScheduleCommand(input.preparation)) {
      return null;
    }
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
      await this.mind.reconcileSelectedPath({
        userId: input.userId,
        conversation: {
          ...conversation,
          currentHeadMessageId: userMessage.id,
        },
      });
    }

    const excludedReferenceIds =
      this.replacementExcludedReferenceIds(
        conversation,
        input.preparation,
      );

    const contextLineage = await this.readContextLineage({
      userId: input.userId,
      conversationId: input.preparation.conversationId,
      parentMessageId: userMessage.parentMessageId,
      runtimeMode: input.preparation.runtimeMode,
    });

    return this.mind.planSemanticUserTurn({
      userId: input.userId,
      conversation,
      userMessage,
      userText: input.preparation.prompt,
      surfaceHeadMessageId: userMessage.parentMessageId,
      manifestId: input.preparation.prepareId,
      excludedReferenceIds,
      contextLineage,
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

    const contextLineage = await this.readContextLineage({
      userId: input.userId,
      conversationId: input.preparation.conversationId,
      parentMessageId: userMessage.parentMessageId,
      runtimeMode: input.preparation.runtimeMode,
    });

    return this.mind.prepareUserTurnFromSemanticPlan({
      userId: input.userId,
      conversation,
      userMessage,
      userText: input.preparation.prompt,
      surfaceHeadMessageId: userMessage.parentMessageId,
      excludedReferenceIds,
      contextLineage,
      plan: input.plan,
      scores: input.scores,
    });
  }

  private async readContextLineage(input: {
    userId: string;
    conversationId: string;
    parentMessageId: string | null;
    runtimeMode: NativeLivePreparedTurn["runtimeMode"];
  }) {
    const lineage = this.contextLineage
      ? await this.contextLineage.readForMessage({
          userId: input.userId,
          conversationId: input.conversationId,
          canonicalMessageId: input.parentMessageId,
        })
      : null;

    // A bootstrap fork can carry provider history even though the new
    // LeileiOS conversation has no canonical parent message yet. Force one
    // authoritative Thought snapshot (including an explicit empty snapshot)
    // so stale aliases from that provider history cannot remain current.
    if (
      lineage
      && input.runtimeMode === "fork"
      && input.parentMessageId === null
    ) {
      return {
        ...lineage,
        forceThoughtSnapshot: true,
      };
    }
    return lineage;
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
      const assistantMessage = conversation.messages.find(
        (candidate) =>
          candidate.id === input.assistantMessageId
          && candidate.role === "assistant",
      );
      if (!assistantMessage) {
        throw new Error(
          "Finalized canonical assistant message was not found.",
        );
      }
      await this.mind.recordAssistantIntents({
        userId: input.userId,
        conversationId: input.preparation.conversationId,
        assistantMessageId: input.assistantMessageId,
        assistantMessageCreatedAt: assistantMessage.createdAt,
        intents: input.intents,
        stateIds: input.stateIds,
      });
    }

    if (input.preparation.operation === "send") return;

    await this.mind.reconcileSelectedPath({
      userId: input.userId,
      conversation,
    });
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
