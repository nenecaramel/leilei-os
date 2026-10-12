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
  messageId: string | null,
): NativeLiveMessage {
  if (!messageId) {
    throw new Error(
      "Prepared turn has no canonical user message.",
    );
  }
  const message = conversation.messages.find(
    (candidate) => candidate.id === messageId,
  );
  if (!message || message.role !== "user") {
    throw new Error("Prepared canonical user message was not found.");
  }
  return message;
}

/**
 * Native Live retains canonical branch/lifecycle validation here. Automatic
 * recall and finalized receipts belong to the installed Claude Code Mind Hook
 * on both clients; Memory creation belongs to the MCP tool.
 */
export class DefaultNativeLiveBackendMindRuntime
implements NativeLiveBackendMindRuntime {
  constructor(
    private readonly conversations: NativeLiveBackendMindConversationReader,
    private readonly mind: Pick<NativeLiveMindRuntime, "reconcileSelectedPath">,
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

    this.validateReplacementTarget(conversation, input.preparation);
    const isVoice = userMessage.blocks.some(
      (block) => block.payload?.input_mode === "voice",
    );
    if (!isVoice) return input.preparation.prompt;

    // Preserve the established Voice annotation, leaving current-turn time
    // and automatic Mind context to the same installed Hooks used by Desktop.
    const text = input.preparation.prompt
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    const isLiveCall = userMessage.blocks.some(
      (block) => block.payload?.input_mode === "voice"
        && block.payload?.interaction_mode === "live_call",
    );
    return isLiveCall
      ? `<user_message input_mode="voice" interaction_mode="live_call">[voice] ${text}</user_message>`
      : `<user_message input_mode="voice">[voice] ${text}</user_message>`;
  }

  async planSemanticPrompt(_input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
  }): Promise<NativeLiveMindSemanticPlan | null> {
    return null;
  }

  async completeSemanticPrompt(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    plan: NativeLiveMindSemanticPlan;
    scores: ReadonlyMap<string, number> | null;
  }): Promise<string> {
    // Drain pre-deployment staged work without injecting another Mind context.
    return this.preparePrompt(input);
  }

  private validateReplacementTarget(
    conversation: NativeLiveConversation,
    preparation: NativeLivePreparedTurn,
  ): void {
    if (
      preparation.operation === "send"
      || preparation.operation === "wake"
    ) {
      return;
    }

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
  }

  parseAssistantBlocks(
    blocks: readonly NativeLiveContentBlockInput[],
  ): ParsedAssistantBlocks {
    // Output tags are prose, never another persistence channel. Do not strip
    // them and pretend a Memory was saved without a successful MCP receipt.
    return { visibleBlocks: blocks.map((block) => ({ ...block })), intents: [] };
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

    if (input.intents.length > 0 && !conversation.messages.some(
      (message) => message.id === input.assistantMessageId
        && message.role === "assistant",
    )) {
      throw new Error("Finalized canonical assistant message was not found.");
    }

    // Ignore persisted legacy tag intents too. MCP alone creates Memory, and
    // the Hook confirms recall. Retain reconciliation for replaced paths.

    if (
      input.preparation.operation === "send"
      || input.preparation.operation === "wake"
    ) return;

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
