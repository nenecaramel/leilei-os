import type {
  NativeLiveConversation,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "./native-live-conversation-types.js";
import {
  canonicalizeNativeLiveEvents,
  type NativeLiveClaudeRuntime,
  type NativeLiveConversationPort,
  type NativeLiveNormalizedEvent,
} from "./native-live-conversation-orchestrator.js";

export type NativeLiveBranchTurnResult =
  | {
      ok: true;
      userMessage: NativeLiveMessage;
      assistantMessage: NativeLiveMessage;
      checkpoint: NativeLiveProviderCheckpoint;
      normalizedEvents: readonly NativeLiveNormalizedEvent[];
    }
  | {
      ok: false;
      userMessage: NativeLiveMessage;
      code:
        | "RUNTIME_FAILURE"
        | "RUNTIME_PROTOCOL_ERROR"
        | "CANONICAL_WRITE_FAILURE";
      message: string;
      normalizedEvents: readonly NativeLiveNormalizedEvent[];
    };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function userPrompt(message: NativeLiveMessage): string {
  const text = message.blocks
    .filter((block) => block.kind === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!text) {
    throw Object.assign(new Error("Native live user message has no text prompt."), {
      code: "NATIVE_LIVE_USER_PROMPT_NOT_FOUND",
    });
  }
  return text;
}

function requireUserMessage(
  conversation: NativeLiveConversation,
  messageId: string,
): NativeLiveMessage {
  const message = conversation.messages.find((candidate) => candidate.id === messageId);
  if (!message || message.role !== "user") {
    throw Object.assign(new Error("Retry/Edit requires a canonical user message."), {
      code: "NATIVE_LIVE_USER_MESSAGE_NOT_FOUND",
    });
  }
  return message;
}

export class NativeLiveConversationBranchOrchestrator {
  constructor(
    private readonly conversations: NativeLiveConversationPort,
    private readonly runtime: NativeLiveClaudeRuntime,
  ) {}

  async retry(input: {
    userId: string;
    conversationId: string;
    targetUserMessageId: string;
  }): Promise<NativeLiveBranchTurnResult> {
    const conversation = await this.requireConversation(input.userId, input.conversationId);
    const target = requireUserMessage(conversation, input.targetUserMessageId);
    return this.completeFromHistoricalParent({
      userId: input.userId,
      conversationId: input.conversationId,
      userMessage: target,
      prompt: userPrompt(target),
      parentAssistantMessageId: target.parentMessageId,
    });
  }

  async edit(input: {
    userId: string;
    conversationId: string;
    targetUserMessageId: string;
    text: string;
  }): Promise<NativeLiveBranchTurnResult> {
    const conversation = await this.requireConversation(input.userId, input.conversationId);
    const target = requireUserMessage(conversation, input.targetUserMessageId);
    const editedUser = await this.conversations.appendUserMessage({
      userId: input.userId,
      conversationId: input.conversationId,
      parentMessageId: target.parentMessageId,
      blocks: [{ kind: "text", rawType: "text", text: input.text }],
    });
    return this.completeFromHistoricalParent({
      userId: input.userId,
      conversationId: input.conversationId,
      userMessage: editedUser,
      prompt: input.text,
      parentAssistantMessageId: target.parentMessageId,
    });
  }

  private async requireConversation(
    userId: string,
    conversationId: string,
  ): Promise<NativeLiveConversation> {
    const conversation = await this.conversations.getConversation({ userId, conversationId });
    if (!conversation) {
      throw Object.assign(new Error("Native live conversation not found."), {
        code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
      });
    }
    return conversation;
  }

  private async completeFromHistoricalParent(input: {
    userId: string;
    conversationId: string;
    userMessage: NativeLiveMessage;
    prompt: string;
    parentAssistantMessageId: string | null;
  }): Promise<NativeLiveBranchTurnResult> {
    let parentCheckpoint: NativeLiveProviderCheckpoint | null = null;
    if (input.parentAssistantMessageId) {
      parentCheckpoint = await this.conversations.getProviderCheckpointForHead({
        userId: input.userId,
        conversationId: input.conversationId,
        canonicalMessageId: input.parentAssistantMessageId,
      });
      if (!parentCheckpoint) {
        throw Object.assign(new Error("Historical assistant checkpoint not found."), {
          code: "NATIVE_LIVE_CHECKPOINT_NOT_FOUND",
        });
      }
    }

    let runtimeResult;
    try {
      runtimeResult = parentCheckpoint
        ? await this.runtime.fork(parentCheckpoint.providerSessionId, input.prompt)
        : await this.runtime.sendNew(input.prompt);
    } catch (error) {
      return {
        ok: false,
        userMessage: input.userMessage,
        code: "RUNTIME_FAILURE",
        message: errorMessage(error),
        normalizedEvents: [],
      };
    }

    if (!runtimeResult.providerSessionId) {
      return {
        ok: false,
        userMessage: input.userMessage,
        code: "RUNTIME_PROTOCOL_ERROR",
        message: "Claude runtime completed without a provider session id.",
        normalizedEvents: runtimeResult.normalizedEvents,
      };
    }

    const canonical = canonicalizeNativeLiveEvents(runtimeResult.normalizedEvents);
    if (canonical.error) {
      return {
        ok: false,
        userMessage: input.userMessage,
        code: "RUNTIME_PROTOCOL_ERROR",
        message: canonical.error,
        normalizedEvents: runtimeResult.normalizedEvents,
      };
    }

    try {
      const completed = await this.conversations.completeAssistantTurn({
        userId: input.userId,
        conversationId: input.conversationId,
        parentMessageId: input.userMessage.id,
        blocks: canonical.blocks,
        checkpoint: {
          provider: "claude_code",
          providerSessionId: runtimeResult.providerSessionId,
        },
      });
      return {
        ok: true,
        userMessage: input.userMessage,
        assistantMessage: completed.message,
        checkpoint: completed.checkpoint,
        normalizedEvents: runtimeResult.normalizedEvents,
      };
    } catch (error) {
      return {
        ok: false,
        userMessage: input.userMessage,
        code: "CANONICAL_WRITE_FAILURE",
        message: errorMessage(error),
        normalizedEvents: runtimeResult.normalizedEvents,
      };
    }
  }
}
