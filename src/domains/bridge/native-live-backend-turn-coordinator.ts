import { randomUUID } from "node:crypto";
import {
  canonicalizeNativeLiveEvents,
  type NativeLiveNormalizedEvent,
} from "../conversation/native-live-conversation-orchestrator.js";
import type {
  NativeLiveContentBlockInput,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "../conversation/native-live-conversation-types.js";
import type {
  NativeLiveBackendMindRuntime,
} from "./native-live-backend-mind-runtime.js";
import type { MindWriteIntent } from "../runtime/mind-intent-parser.js";
import type { MindSemanticAction } from "../runtime/mind-semantic-action.js";
import type { NativeLiveExecutionSelection } from "./native-live-execution-selection.js";
import {
  NativeLiveRelayContractError,
  parseNativeLiveRelayRequest,
  type NativeLiveRelayRequest,
} from "./native-live-relay-contract.js";
import {
  NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
  NATIVE_LIVE_RUNTIME_LEGACY_PROTOCOL_VERSION,
  NativeLiveRuntimeProtocolError,
  assertRuntimeResultMatchesCommand,
  parseNativeLiveRuntimeExecutionResult,
  type NativeLiveRuntimeAttachment,
  type NativeLiveRuntimeCommand,
  type NativeLiveRuntimeExecutionResult,
  type NativeLiveRuntimeFailureCode,
  type NativeLiveRuntimeMetadata,
  type NativeLiveRuntimeMode,
} from "./native-live-runtime-protocol.js";

export type NativeLivePreparedTurn = {
  prepareId: string;
  requestId: string;
  userId: string;
  conversationId: string;
  operation: NativeLiveRelayRequest["operation"];
  canonicalUserMessageId: string;
  replacementTargetUserMessageId?: string | null;
  runtimeMode: NativeLiveRuntimeMode;
  parentProviderSessionId: string | null;
  workspaceId: string | null;
  expectedWorkspaceRoot: string | null;
  executionSelection?: NativeLiveExecutionSelection | null;
  attachments: NativeLiveRuntimeAttachment[];
  prompt: string;
  mindPrepared: boolean;
};

export type NativeLivePrepareFailureCode =
  | "INVALID_REQUEST"
  | "CONVERSATION_NOT_FOUND"
  | "STALE_HEAD"
  | "BRANCH_POINT_INVALID"
  | "CHECKPOINT_NOT_FOUND"
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_BINDING_AMBIGUOUS"
  | "WORKSPACE_BINDING_CONFLICT"
  | "REQUEST_CONFLICT"
  | "INTERNAL_ERROR";

export type NativeLivePreparePortResult =
  | {
      ok: true;
      outcome: "created" | "replayed";
      preparation: NativeLivePreparedTurn;
    }
  | {
      ok: false;
      code: Exclude<NativeLivePrepareFailureCode, "INVALID_REQUEST" | "INTERNAL_ERROR">;
      currentHeadMessageId?: string | null;
    };

export type NativeLivePrepareResult =
  | {
      ok: true;
      outcome: "created" | "replayed";
      command: NativeLiveRuntimeCommand;
    }
  | {
      ok: false;
      requestId: string | null;
      operation: NativeLiveRelayRequest["operation"] | null;
      conversationId: string | null;
      code: NativeLivePrepareFailureCode;
      currentHeadMessageId?: string | null;
    };

export type NativeLiveFinalizeFailureCode =
  | NativeLiveRuntimeFailureCode
  | "INVALID_RESULT"
  | "PREPARATION_NOT_FOUND"
  | "RESULT_MISMATCH"
  | "RUNTIME_PROTOCOL_ERROR"
  | "FINALIZE_CONFLICT"
  | "CANONICAL_WRITE_FAILURE"
  | "INTERNAL_ERROR";

export type NativeLiveFinalizeSuccessRecord = {
  assistantMessage: NativeLiveMessage;
  checkpoint: NativeLiveProviderCheckpoint;
};

export type NativeLiveMindFollowUpPayload = {
  intents: readonly MindWriteIntent[];
  actions: readonly MindSemanticAction[];
};

export interface NativeLivePostFinalizeRunner {
  processPreparation(input: {
    userId: string;
    prepareId: string;
  }): Promise<unknown>;
}

export type NativeLiveFinalizeSuccessPortResult =
  | {
      ok: true;
      outcome: "completed" | "idempotent";
      record: NativeLiveFinalizeSuccessRecord;
    }
  | {
      ok: false;
      code: "FINALIZE_CONFLICT" | "CANONICAL_WRITE_FAILURE";
    };

export type NativeLiveFinalizeFailurePortResult =
  | { ok: true; outcome: "recorded" | "idempotent" }
  | { ok: false; code: "FINALIZE_CONFLICT" };

export type NativeLiveFinalizeResult =
  | {
      ok: true;
      outcome: "completed" | "idempotent";
      requestId: string;
      operation: NativeLiveRelayRequest["operation"];
      conversationId: string;
      userMessageId: string;
      assistantMessageId: string;
      checkpointId: string;
      providerSessionId: string;
    }
  | {
      ok: false;
      prepareId: string | null;
      requestId: string | null;
      conversationId: string | null;
      code: NativeLiveFinalizeFailureCode;
    };

/**
 * Future DB implementation requirements:
 *
 * - prepare* must atomically validate canonical ownership / branch preconditions,
 *   create or select the canonical user message where applicable, resolve the
 *   exact parent provider checkpoint, and persist an idempotent preparation
 *   record keyed by request id.
 * - finalizeSuccess must atomically lock that preparation, reject conflicting
 *   replays, append assistant blocks, bind the provider checkpoint, advance
 *   current head, and mark the preparation finalized.
 * - finalizeFailure must atomically record the terminal runtime failure without
 *   fabricating an assistant message or advancing current head.
 */
export interface NativeLiveBackendTurnPort {
  prepareSend(input: {
    prepareId: string;
    userId: string;
    requestId: string;
    conversationId: string;
    expectedHeadMessageId: string | null;
    text: string;
    attachmentIds: readonly string[];
    workspaceId: string | null;
    executionSelection: NativeLiveExecutionSelection | null;
  }): Promise<NativeLivePreparePortResult>;

  prepareRetry(input: {
    prepareId: string;
    userId: string;
    requestId: string;
    conversationId: string;
    targetUserMessageId: string;
    executionSelection: NativeLiveExecutionSelection | null;
  }): Promise<NativeLivePreparePortResult>;

  prepareEdit(input: {
    prepareId: string;
    userId: string;
    requestId: string;
    conversationId: string;
    targetUserMessageId: string;
    text: string;
    attachmentIds: readonly string[] | null;
    executionSelection: NativeLiveExecutionSelection | null;
  }): Promise<NativeLivePreparePortResult>;

  getPreparation(input: {
    userId: string;
    prepareId: string;
  }): Promise<NativeLivePreparedTurn | null>;

  persistMindPreparedPrompt(input: {
    userId: string;
    prepareId: string;
    prompt: string;
  }): Promise<NativeLivePreparedTurn>;

  finalizeSuccess(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    providerSessionId: string;
    workspaceId: string | null;
    effectiveWorkspaceRoot: string | null;
    blocks: NativeLiveContentBlockInput[];
    normalizedEvents: readonly NativeLiveNormalizedEvent[];
    runtimeMetadata: NativeLiveRuntimeMetadata | null;
    mindFollowUp: NativeLiveMindFollowUpPayload | null;
  }): Promise<NativeLiveFinalizeSuccessPortResult>;

  finalizeFailure(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    errorCode: NativeLiveRuntimeFailureCode | "RUNTIME_PROTOCOL_ERROR";
  }): Promise<NativeLiveFinalizeFailurePortResult>;
}

export class NativeLiveBackendTurnCoordinator {
  constructor(
    private readonly port: NativeLiveBackendTurnPort,
    private readonly createPrepareId: () => string = randomUUID,
    private readonly mind: NativeLiveBackendMindRuntime | null = null,
    private readonly postFinalize: NativeLivePostFinalizeRunner | null = null,
  ) {}

  async prepare(
    userId: string,
    rawRequest: unknown,
  ): Promise<NativeLivePrepareResult> {
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

    const prepareId = this.createPrepareId();
    let prepared: NativeLivePreparePortResult;
    try {
      if (request.operation === "send") {
        prepared = await this.port.prepareSend({
          prepareId,
          userId,
          requestId: request.request_id,
          conversationId: request.conversation_id,
          expectedHeadMessageId: request.expected_head_message_id,
          text: request.text,
          attachmentIds: request.attachment_ids ?? [],
          workspaceId: request.workspace_id ?? null,
          executionSelection: request.execution ?? null,
        });
      } else if (request.operation === "retry") {
        prepared = await this.port.prepareRetry({
          prepareId,
          userId,
          requestId: request.request_id,
          conversationId: request.conversation_id,
          targetUserMessageId: request.target_user_message_id,
          executionSelection: request.execution ?? null,
        });
      } else {
        prepared = await this.port.prepareEdit({
          prepareId,
          userId,
          requestId: request.request_id,
          conversationId: request.conversation_id,
          targetUserMessageId: request.target_user_message_id,
          text: request.text,
          attachmentIds:
            request.attachment_ids === undefined
              ? null
              : request.attachment_ids,
          executionSelection: request.execution ?? null,
        });
      }
    } catch {
      return {
        ok: false,
        requestId: request.request_id,
        operation: request.operation,
        conversationId: request.conversation_id,
        code: "INTERNAL_ERROR",
      };
    }

    if (!prepared.ok) {
      return {
        ok: false,
        requestId: request.request_id,
        operation: request.operation,
        conversationId: request.conversation_id,
        code: prepared.code,
        ...(prepared.currentHeadMessageId !== undefined
          ? { currentHeadMessageId: prepared.currentHeadMessageId }
          : {}),
      };
    }

    let preparation = prepared.preparation;
    if (this.mind && !preparation.mindPrepared) {
      try {
        const prompt = await this.mind.preparePrompt({
          userId,
          preparation,
        });
        preparation = await this.port.persistMindPreparedPrompt({
          userId,
          prepareId: preparation.prepareId,
          prompt,
        });
        if (!preparation.mindPrepared) {
          throw new Error("Mind-prepared prompt was not persisted.");
        }
      } catch {
        return {
          ok: false,
          requestId: request.request_id,
          operation: request.operation,
          conversationId: request.conversation_id,
          code: "INTERNAL_ERROR",
        };
      }
    }

    return {
      ok: true,
      outcome: prepared.outcome,
      command: nativeLiveRuntimeCommandFromPreparation(preparation),
    };
  }

  async finalize(
    userId: string,
    rawResult: unknown,
  ): Promise<NativeLiveFinalizeResult> {
    let result: NativeLiveRuntimeExecutionResult;
    try {
      result = parseNativeLiveRuntimeExecutionResult(rawResult);
    } catch (error) {
      if (error instanceof NativeLiveRuntimeProtocolError) {
        return {
          ok: false,
          prepareId: readStringField(rawResult, "prepare_id"),
          requestId: readStringField(rawResult, "request_id"),
          conversationId: readStringField(rawResult, "conversation_id"),
          code: "INVALID_RESULT",
        };
      }
      return {
        ok: false,
        prepareId: null,
        requestId: null,
        conversationId: null,
        code: "INTERNAL_ERROR",
      };
    }

    let preparation: NativeLivePreparedTurn | null;
    try {
      preparation = await this.port.getPreparation({
        userId,
        prepareId: result.prepare_id,
      });
    } catch {
      return failureForResult(result, "INTERNAL_ERROR");
    }

    if (!preparation) {
      return failureForResult(result, "PREPARATION_NOT_FOUND");
    }

    const command = nativeLiveRuntimeCommandFromPreparation(preparation);
    try {
      assertRuntimeResultMatchesCommand(command, result);
    } catch (error) {
      if (error instanceof NativeLiveRuntimeProtocolError) {
        return failureForResult(result, "RESULT_MISMATCH");
      }
      return failureForResult(result, "INTERNAL_ERROR");
    }

    if (result.status === "failure") {
      try {
        const recorded = await this.port.finalizeFailure({
          userId,
          preparation,
          errorCode: result.error_code,
        });
        if (!recorded.ok) {
          return failureForResult(result, recorded.code);
        }
        return failureForResult(result, result.error_code);
      } catch {
        return failureForResult(result, "INTERNAL_ERROR");
      }
    }

    const canonical = canonicalizeNativeLiveEvents(result.normalized_events);
    if (canonical.error) {
      try {
        const recorded = await this.port.finalizeFailure({
          userId,
          preparation,
          errorCode: "RUNTIME_PROTOCOL_ERROR",
        });
        if (!recorded.ok) {
          return failureForResult(result, recorded.code);
        }
      } catch {
        return failureForResult(result, "INTERNAL_ERROR");
      }
      return failureForResult(result, "RUNTIME_PROTOCOL_ERROR");
    }

    const parsedMind = this.mind
      ? this.mind.parseAssistantBlocks(canonical.blocks)
      : { visibleBlocks: canonical.blocks, intents: [], actions: [] };

    let finalized: NativeLiveFinalizeSuccessPortResult;
    try {
      finalized = await this.port.finalizeSuccess({
        userId,
        preparation,
        providerSessionId: result.provider_session_id,
        workspaceId: result.workspace_id,
        effectiveWorkspaceRoot: result.effective_workspace_root,
        blocks: parsedMind.visibleBlocks,
        normalizedEvents: result.normalized_events,
        runtimeMetadata: result.runtime_metadata ?? null,
        mindFollowUp: this.mind && this.postFinalize
          ? {
              intents: parsedMind.intents,
              actions: parsedMind.actions ?? [],
            }
          : null,
      });
    } catch {
      return failureForResult(result, "INTERNAL_ERROR");
    }

    if (!finalized.ok) {
      return failureForResult(result, finalized.code);
    }

    if (this.postFinalize) {
      try {
        await this.postFinalize.processPreparation({
          userId,
          prepareId: preparation.prepareId,
        });
      } catch {
        // The canonical completion and durable follow-up row are already
        // committed together. The background worker can retry the follow-up.
      }
    } else if (
      this.mind
      && finalized.outcome === "completed"
    ) {
      try {
        await this.mind.afterFinalize({
          userId,
          preparation,
          assistantMessageId: finalized.record.assistantMessage.id,
          intents: parsedMind.intents,
        });
      } catch {
        // Compatibility fallback for non-durable test/local bindings.
      }
    }

    return {
      ok: true,
      outcome: finalized.outcome,
      requestId: preparation.requestId,
      operation: preparation.operation,
      conversationId: preparation.conversationId,
      userMessageId: preparation.canonicalUserMessageId,
      assistantMessageId: finalized.record.assistantMessage.id,
      checkpointId: finalized.record.checkpoint.id,
      providerSessionId: finalized.record.checkpoint.providerSessionId,
    };
  }
}

export function nativeLiveRuntimeCommandFromPreparation(
  preparation: NativeLivePreparedTurn,
): NativeLiveRuntimeCommand {
  const hasAttachments = preparation.attachments.length > 0;
  const command: NativeLiveRuntimeCommand = {
    protocol_version:
      hasAttachments
        ? NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION
        : NATIVE_LIVE_RUNTIME_LEGACY_PROTOCOL_VERSION,
    dispatch_target: "claude_code",
    prepare_id: preparation.prepareId,
    request_id: preparation.requestId,
    operation: preparation.operation,
    conversation_id: preparation.conversationId,
    canonical_user_message_id: preparation.canonicalUserMessageId,
    runtime_mode: preparation.runtimeMode,
    parent_provider_session_id: preparation.parentProviderSessionId,
    workspace_id: preparation.workspaceId ?? null,
    expected_workspace_root:
      preparation.expectedWorkspaceRoot ?? null,
    execution_selection: preparation.executionSelection ?? null,
    ...(hasAttachments
      ? { attachments: preparation.attachments }
      : {}),
    prompt: preparation.prompt,
  };
  return command;
}

function failureForResult(
  result: NativeLiveRuntimeExecutionResult,
  code: NativeLiveFinalizeFailureCode,
): NativeLiveFinalizeResult {
  return {
    ok: false,
    prepareId: result.prepare_id,
    requestId: result.request_id,
    conversationId: result.conversation_id,
    code,
  };
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
