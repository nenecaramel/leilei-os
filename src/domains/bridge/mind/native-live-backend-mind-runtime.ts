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


function renderHookOwnedUserPrompt(
  userMessage: NativeLiveMessage,
  prompt: string,
): string {
  // Preserve the canonical voice identity, but leave clock/context to the
  // installed Claude Code hooks. No per-message timestamp is injected here.
  const isVoice = userMessage.blocks.some(
    (block) =>
      block.kind === "text"
      && block.payload !== null
      && typeof block.payload === "object"
      && !Array.isArray(block.payload)
      && block.payload.input_mode === "voice",
  );
  const escaped = prompt
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const mode = isVoice ? ' input_mode="voice"' : "";
  return `<user_message${mode}>${isVoice ? "[voice] " : ""}${escaped}</user_message>`;
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
    _contextLineage: NativeLiveContextLineageReader | null = null,
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

    // Existing path-scoped memories remain valid historical records, so retain
    // their branch settlement/retirement bookkeeping while retiring new writes.
    if (input.preparation.operation === "send") {
      await this.mind.reconcileSelectedPath({
        userId: input.userId,
        conversation: { ...conversation, currentHeadMessageId: userMessage.id },
      });
    }
    // Native slash commands must reach Claude Code unwrapped.
    if (isNativeClaudeScheduleCommand(input.preparation)) {
      return input.preparation.prompt;
    }
    return renderHookOwnedUserPrompt(userMessage, input.preparation.prompt);
  }

  async planSemanticPrompt(_input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
  }): Promise<NativeLiveMindSemanticPlan | null> {
    // UserPromptSubmit owns all new recall, including semantic retrieval.
    return null;
  }

  async completeSemanticPrompt(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    plan: NativeLiveMindSemanticPlan;
    scores: ReadonlyMap<string, number> | null;
  }): Promise<string> {
    // Backward-compatible completion of an already queued semantic request:
    // never inject the old Context Assembly on top of the hook.
    const conversation = await this.requireConversation(
      input.userId,
      input.preparation.conversationId,
    );
    const userMessage = requirePreparedUserMessage(
      conversation,
      input.preparation.canonicalUserMessageId,
    );
    return isNativeClaudeScheduleCommand(input.preparation)
      ? input.preparation.prompt
      : renderHookOwnedUserPrompt(userMessage, input.preparation.prompt);
  }

  parseAssistantBlocks(
    blocks: readonly NativeLiveContentBlockInput[],
  ): ParsedAssistantBlocks {
    // Do not interpret newly emitted <memory> tags as writes; MCP write_memory
    // is the only active authoring path. Historical queued intents can still
    // finish through afterFinalize for backward compatibility.
    return { visibleBlocks: blocks.map((block) => ({ ...block })), intents: [], actions: [] };
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
