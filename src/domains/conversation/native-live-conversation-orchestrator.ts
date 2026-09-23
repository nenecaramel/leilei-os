import type {
  NativeLiveContentBlockInput,
  NativeLiveConversation,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "./native-live-conversation-types.js";
import type { NativeLiveMindRuntime } from "../runtime/native-live-mind-runtime.js";
import type { NativeLiveBackgroundOpportunity } from "../runtime/native-live-background-opportunity.js";

export type NativeLiveNormalizedEventType =
  | "session"
  | "text"
  | "partial_text"
  | "tool_use"
  | "tool_result"
  | "attachment"
  | "result"
  | "error"
  | "runtime";

export type NativeLiveNormalizedEvent = {
  type: NativeLiveNormalizedEventType;
  provider_session_id?: string | null;
  payload?: Record<string, unknown>;
};

export type NativeLiveRuntimeResult = {
  providerSessionId: string | null;
  normalizedEvents: readonly NativeLiveNormalizedEvent[];
};

export interface NativeLiveClaudeRuntime {
  sendNew(prompt: string): Promise<NativeLiveRuntimeResult>;
  resume(sessionId: string, prompt: string): Promise<NativeLiveRuntimeResult>;
  fork(sessionId: string, prompt: string): Promise<NativeLiveRuntimeResult>;
}

export interface NativeLiveConversationPort {
  getConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversation | null>;

  appendUserMessage(input: {
    userId: string;
    conversationId: string;
    parentMessageId: string | null;
    blocks: NativeLiveContentBlockInput[];
  }): Promise<NativeLiveMessage>;

  completeAssistantTurn(input: {
    userId: string;
    conversationId: string;
    parentMessageId: string;
    blocks: NativeLiveContentBlockInput[];
    checkpoint: {
      provider: "claude_code";
      providerSessionId: string;
      providerCheckpointId?: string | null;
    };
  }): Promise<{
    message: NativeLiveMessage;
    checkpoint: NativeLiveProviderCheckpoint;
  }>;

  getProviderCheckpointForHead(input: {
    userId: string;
    conversationId: string;
    canonicalMessageId: string;
  }): Promise<NativeLiveProviderCheckpoint | null>;
}

export type NativeLiveSendResult =
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
        | "CANONICAL_WRITE_FAILURE"
        | "CANONICAL_CHECKPOINT_MISSING";
      message: string;
      normalizedEvents: readonly NativeLiveNormalizedEvent[];
    };

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function canonicalizeNativeLiveEvents(events: readonly NativeLiveNormalizedEvent[]): {
  blocks: NativeLiveContentBlockInput[];
  error: string | null;
} {
  const blocks: NativeLiveContentBlockInput[] = [];
  let finalText: string | null = null;
  let error: string | null = null;
  let sawText = false;

  for (const event of events) {
    const payload = event.payload ?? {};

    if (event.type === "error") {
      error =
        stringValue(payload.message) ??
        stringValue(payload.code) ??
        "Claude runtime emitted an error event.";
      continue;
    }

    if (event.type === "result") {
      if (payload.status === "error") {
        error =
          stringValue(payload.message) ??
          "Claude runtime result reported an error.";
      }
      finalText = stringValue(payload.final_text) ?? finalText;
      continue;
    }

    if (event.type === "text") {
      const text = stringValue(payload.text);
      if (text) {
        sawText = true;
        blocks.push({
          kind: "text",
          rawType: "text",
          text,
        });
      }
      continue;
    }

    if (event.type === "tool_use") {
      blocks.push({
        kind: "tool_use",
        rawType: "tool_use",
        payload,
      });
      continue;
    }

    if (event.type === "tool_result") {
      blocks.push({
        kind: "tool_result",
        rawType: "tool_result",
        payload,
      });
      continue;
    }

    if (event.type === "attachment") {
      blocks.push({
        kind: "attachment",
        rawType: "attachment",
        payload,
      });
    }
  }

  if (!sawText && finalText) {
    blocks.push({
      kind: "text",
      rawType: "result",
      text: finalText,
    });
  }

  return { blocks, error };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Minimal persisted native/live send path.
 *
 * The user row is committed before invoking Claude. The assistant row,
 * provider checkpoint, and current head move are committed atomically by
 * NativeLiveConversationService only after the runtime succeeds.
 *
 * Ordinary progression forks from the exact checkpoint bound to the current
 * canonical assistant head. resume() remains in the transport contract but is
 * intentionally not used for normal chat progression.
 */
export class NativeLiveConversationOrchestrator {
  constructor(
    private readonly conversations: NativeLiveConversationPort,
    private readonly runtime: NativeLiveClaudeRuntime,
    private readonly mind: NativeLiveMindRuntime | null = null,
    private readonly backgroundOpportunity: NativeLiveBackgroundOpportunity | null = null,
  ) {}

  async send(input: {
    userId: string;
    conversationId: string;
    text: string;
  }): Promise<NativeLiveSendResult> {
    const conversation = await this.conversations.getConversation({
      userId: input.userId,
      conversationId: input.conversationId,
    });
    if (!conversation) {
      throw Object.assign(new Error("Native live conversation not found."), {
        code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
      });
    }

    const parentHead = conversation.currentHeadMessageId;
    const userMessage = await this.conversations.appendUserMessage({
      userId: input.userId,
      conversationId: input.conversationId,
      parentMessageId: parentHead,
      blocks: [{ kind: "text", rawType: "text", text: input.text }],
    });

    const turnConversation: NativeLiveConversation = {
      ...conversation,
      messages: [...conversation.messages, userMessage],
    };

    let runtimePrompt = input.text;
    if (this.mind) {
      await this.mind.reconcileSelectedPath({
        userId: input.userId,
        conversation: {
          ...turnConversation,
          currentHeadMessageId: userMessage.id,
        },
      });
      runtimePrompt = await this.mind.prepareUserTurn({
        userId: input.userId,
        conversation: turnConversation,
        userMessage,
        userText: input.text,
        surfaceHeadMessageId: parentHead,
      });
    }

    const parentCheckpoint = parentHead
      ? await this.conversations.getProviderCheckpointForHead({
          userId: input.userId,
          conversationId: input.conversationId,
          canonicalMessageId: parentHead,
        })
      : null;

    if (parentHead && !parentCheckpoint) {
      return {
        ok: false,
        userMessage,
        code: "CANONICAL_CHECKPOINT_MISSING",
        message: "Current canonical assistant head has no provider checkpoint.",
        normalizedEvents: [],
      };
    }

    let runtimeResult: NativeLiveRuntimeResult;
    try {
      runtimeResult = parentCheckpoint
        ? await this.runtime.fork(
            parentCheckpoint.providerSessionId,
            runtimePrompt,
          )
        : await this.runtime.sendNew(runtimePrompt);
    } catch (error) {
      return {
        ok: false,
        userMessage,
        code: "RUNTIME_FAILURE",
        message: messageOf(error),
        normalizedEvents: [],
      };
    }

    if (!runtimeResult.providerSessionId) {
      return {
        ok: false,
        userMessage,
        code: "RUNTIME_PROTOCOL_ERROR",
        message: "Claude runtime completed without a provider session id.",
        normalizedEvents: runtimeResult.normalizedEvents,
      };
    }

    const canonical = canonicalizeNativeLiveEvents(runtimeResult.normalizedEvents);
    if (canonical.error) {
      return {
        ok: false,
        userMessage,
        code: "RUNTIME_PROTOCOL_ERROR",
        message: canonical.error,
        normalizedEvents: runtimeResult.normalizedEvents,
      };
    }

    const parsedMind = this.mind
      ? this.mind.parseAssistantBlocks(canonical.blocks)
      : { visibleBlocks: canonical.blocks, intents: [] };

    try {
      const completed = await this.conversations.completeAssistantTurn({
        userId: input.userId,
        conversationId: input.conversationId,
        parentMessageId: userMessage.id,
        blocks: parsedMind.visibleBlocks,
        checkpoint: {
          provider: "claude_code",
          providerSessionId: runtimeResult.providerSessionId,
        },
      });

      if (this.mind && parsedMind.intents.length > 0) {
        await this.mind.recordAssistantIntents({
          userId: input.userId,
          conversationId: input.conversationId,
          assistantMessageId: completed.message.id,
          intents: parsedMind.intents,
        });
      }

      this.backgroundOpportunity?.schedule({
        userId: input.userId,
        conversationId: input.conversationId,
      });

      return {
        ok: true,
        userMessage,
        assistantMessage: completed.message,
        checkpoint: completed.checkpoint,
        normalizedEvents: runtimeResult.normalizedEvents,
      };
    } catch (error) {
      return {
        ok: false,
        userMessage,
        code: "CANONICAL_WRITE_FAILURE",
        message: messageOf(error),
        normalizedEvents: runtimeResult.normalizedEvents,
      };
    }
  }
}
