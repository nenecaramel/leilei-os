import type {
  NativeLiveConversation,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "../conversation/native-live-conversation-types.js";
import type {
  NativeLiveSendResult,
} from "../conversation/native-live-conversation-orchestrator.js";
import type {
  NativeLiveBranchTurnResult,
} from "../conversation/native-live-conversation-branch-orchestrator.js";
import {
  NativeLiveRelayContractError,
  parseNativeLiveRelayRequest,
  type NativeLiveRelayRequest,
} from "./native-live-relay-contract.js";

export type NativeLiveRelayConsumerSuccess = {
  ok: true;
  requestId: string;
  operation: NativeLiveRelayRequest["operation"];
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  checkpointId: string;
  providerSessionId: string;
};

export type NativeLiveRelayConsumerFailureCode =
  | "INVALID_REQUEST"
  | "CONVERSATION_NOT_FOUND"
  | "STALE_HEAD"
  | "RUNTIME_FAILURE"
  | "RUNTIME_PROTOCOL_ERROR"
  | "CANONICAL_WRITE_FAILURE"
  | "BRANCH_POINT_INVALID"
  | "CHECKPOINT_NOT_FOUND"
  | "INTERNAL_ERROR";

export type NativeLiveRelayConsumerFailure = {
  ok: false;
  requestId: string | null;
  operation: NativeLiveRelayRequest["operation"] | null;
  conversationId: string | null;
  code: NativeLiveRelayConsumerFailureCode;
  currentHeadMessageId?: string | null;
};

export type NativeLiveRelayConsumerResult =
  | NativeLiveRelayConsumerSuccess
  | NativeLiveRelayConsumerFailure;

export interface NativeLiveRelayConversationReader {
  getConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversation | null>;
}

export interface NativeLiveRelaySendExecutor {
  send(input: {
    userId: string;
    conversationId: string;
    text: string;
  }): Promise<NativeLiveSendResult>;
}

export interface NativeLiveRelayBranchExecutor {
  retry(input: {
    userId: string;
    conversationId: string;
    targetUserMessageId: string;
  }): Promise<NativeLiveBranchTurnResult>;

  edit(input: {
    userId: string;
    conversationId: string;
    targetUserMessageId: string;
    text: string;
  }): Promise<NativeLiveBranchTurnResult>;
}

/**
 * Executes a validated cross-device native/live command against the canonical
 * conversation orchestrators.
 *
 * Send uses expected_head_message_id as an optimistic stale-client guard.
 * This guard relies on the Claude relay being the single writer lane for the
 * authenticated user's native/live queue. If other concurrent writer lanes are
 * introduced later, the same precondition must move into an atomic DB CAS.
 */
export class NativeLiveRelayConsumer {
  constructor(
    private readonly conversations: NativeLiveRelayConversationReader,
    private readonly sendExecutor: NativeLiveRelaySendExecutor,
    private readonly branchExecutor: NativeLiveRelayBranchExecutor,
  ) {}

  async consume(
    userId: string,
    rawRequest: unknown,
  ): Promise<NativeLiveRelayConsumerResult> {
    let request: NativeLiveRelayRequest;
    try {
      request = parseNativeLiveRelayRequest(rawRequest);
    } catch (error) {
      if (error instanceof NativeLiveRelayContractError) {
        return {
          ok: false,
          requestId: readStringField(rawRequest, "request_id"),
          operation: readOperation(rawRequest),
          conversationId: readStringField(rawRequest, "conversation_id"),
          code: "INVALID_REQUEST",
        };
      }
      return {
        ok: false,
        requestId: null,
        operation: null,
        conversationId: null,
        code: "INTERNAL_ERROR",
      };
    }

    try {
      if (request.operation === "send") {
        return this.consumeSend(userId, request);
      }

      if (request.operation === "retry") {
        const result = await this.branchExecutor.retry({
          userId,
          conversationId: request.conversation_id,
          targetUserMessageId: request.target_user_message_id,
        });
        return mapTurnResult(request, result);
      }

      const result = await this.branchExecutor.edit({
        userId,
        conversationId: request.conversation_id,
        targetUserMessageId: request.target_user_message_id,
        text: request.text,
      });
      return mapTurnResult(request, result);
    } catch (error) {
      return {
        ok: false,
        requestId: request.request_id,
        operation: request.operation,
        conversationId: request.conversation_id,
        code: mapThrownErrorCode(error),
      };
    }
  }

  private async consumeSend(
    userId: string,
    request: Extract<NativeLiveRelayRequest, { operation: "send" }>,
  ): Promise<NativeLiveRelayConsumerResult> {
    const conversation = await this.conversations.getConversation({
      userId,
      conversationId: request.conversation_id,
    });

    if (!conversation) {
      return {
        ok: false,
        requestId: request.request_id,
        operation: request.operation,
        conversationId: request.conversation_id,
        code: "CONVERSATION_NOT_FOUND",
      };
    }

    if (conversation.currentHeadMessageId !== request.expected_head_message_id) {
      return {
        ok: false,
        requestId: request.request_id,
        operation: request.operation,
        conversationId: request.conversation_id,
        code: "STALE_HEAD",
        currentHeadMessageId: conversation.currentHeadMessageId,
      };
    }

    const result = await this.sendExecutor.send({
      userId,
      conversationId: request.conversation_id,
      text: request.text,
    });
    return mapTurnResult(request, result);
  }
}

function mapTurnResult(
  request: NativeLiveRelayRequest,
  result: NativeLiveSendResult | NativeLiveBranchTurnResult,
): NativeLiveRelayConsumerResult {
  if (!result.ok) {
    return {
      ok: false,
      requestId: request.request_id,
      operation: request.operation,
      conversationId: request.conversation_id,
      code:
        result.code === "CANONICAL_CHECKPOINT_MISSING"
          ? "CHECKPOINT_NOT_FOUND"
          : result.code,
    };
  }

  return {
    ok: true,
    requestId: request.request_id,
    operation: request.operation,
    conversationId: request.conversation_id,
    userMessageId: result.userMessage.id,
    assistantMessageId: result.assistantMessage.id,
    checkpointId: result.checkpoint.id,
    providerSessionId: result.checkpoint.providerSessionId,
  };
}

function mapThrownErrorCode(error: unknown): NativeLiveRelayConsumerFailureCode {
  const code =
    typeof error === "object"
    && error !== null
    && "code" in error
    && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;

  if (code === "NATIVE_LIVE_CONVERSATION_NOT_FOUND") {
    return "CONVERSATION_NOT_FOUND";
  }
  if (code === "NATIVE_LIVE_USER_MESSAGE_NOT_FOUND") {
    return "BRANCH_POINT_INVALID";
  }
  if (code === "NATIVE_LIVE_CHECKPOINT_NOT_FOUND") {
    return "CHECKPOINT_NOT_FOUND";
  }
  return "INTERNAL_ERROR";
}

function readStringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : null;
}

function readOperation(
  value: unknown,
): NativeLiveRelayRequest["operation"] | null {
  const operation = readStringField(value, "operation");
  return operation === "send" || operation === "retry" || operation === "edit"
    ? operation
    : null;
}

export type {
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
};
