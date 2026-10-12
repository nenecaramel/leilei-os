import { randomUUID } from "node:crypto";
import {
  canonicalizeNativeLiveEvents,
  type NativeLiveNormalizedEvent,
} from "../../conversation/native-live-conversation-orchestrator.js";
import { extractNativeLiveMurmur } from "./native-live-murmur.js";
import type {
  NativeLiveContentBlockInput,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "../../conversation/native-live-conversation-types.js";
import type {
  NativeLiveBackendMindRuntime,
} from "../mind/native-live-backend-mind-runtime.js";
import type { MindWriteIntent } from "../../runtime/mind/mind-intent-parser.js";
import type { MindSemanticAction } from "../../runtime/mind/mind-semantic-action.js";
import type { NativeLiveExecutionSelection } from "./native-live-execution-selection.js";
import {
  NativeLiveRelayContractError,
  parseNativeLiveRelayRequest,
  type NativeLiveRelayRequest,
} from "../protocol/native-live-relay-contract.js";
import {
  NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
  NativeLiveRuntimeProtocolError,
  assertRuntimeResultMatchesCommand,
  parseNativeLiveRuntimeExecutionResult,
  type NativeLiveRuntimeAttachment,
  type NativeLiveRuntimeCommand,
  type NativeLiveRuntimeExecutionResult,
  type NativeLiveRuntimeFailureCode,
  type NativeLiveRuntimeMetadata,
  type NativeLiveRuntimeMode,
  type NativeLiveRuntimeOutputAttachmentMetadata,
} from "../protocol/native-live-runtime-protocol.js";

export type NativeLivePreparedTurn = {
  prepareId: string;
  requestId: string;
  userId: string;
  conversationId: string;
  operation: NativeLiveRelayRequest["operation"] | "wake";
  canonicalUserMessageId: string | null;
  wakeContext?: Record<string, unknown> | null;
  replacementTargetUserMessageId?: string | null;
  runtimeMode: NativeLiveRuntimeMode;
  parentProviderSessionId: string | null;
  expectedWorkingDirectory: string | null;
  parentProviderCheckpointId?: string | null;
  failedUserMessageUuids?: readonly string[];
  executionSelection?: NativeLiveExecutionSelection | null;
  attachments?: NativeLiveRuntimeAttachment[];
  prompt: string;
  mindPrepared: boolean;
};

export type NativeLivePrepareFailureCode =
  | "INVALID_REQUEST"
  | "CONVERSATION_NOT_FOUND"
  | "STALE_HEAD"
  | "BRANCH_POINT_INVALID"
  | "CHECKPOINT_NOT_FOUND"
  | "REQUEST_CONFLICT"
  | "SESSION_OWNED_BY_DESKTOP"
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
      ok: true;
      outcome: "wake_discarded";
      record: null;
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
      operation: NativeLiveRelayRequest["operation"] | "wake";
      conversationId: string;
      userMessageId: string | null;
      assistantMessageId: string;
      checkpointId: string;
      providerSessionId: string;
    }
  | {
      ok: true;
      outcome: "wake_quiet" | "wake_stale" | "wake_failed" | "wake_discarded";
      requestId: string;
      operation: "wake";
      conversationId: string;
      providerSessionId: string | null;
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
    inputMode?: "voice";
    interactionMode?: "live_call";
    attachmentIds: readonly string[];
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
    effectiveWorkingDirectory: string | null;
    providerCheckpointId?: string | null;
    blocks: NativeLiveContentBlockInput[];
    outputAttachmentIds: readonly string[];
    outputAttachmentMetadata?:
      readonly NativeLiveRuntimeOutputAttachmentMetadata[];
    normalizedEvents: readonly NativeLiveNormalizedEvent[];
    runtimeMetadata: NativeLiveRuntimeMetadata | null;
    mindFollowUp: NativeLiveMindFollowUpPayload | null;
  }): Promise<NativeLiveFinalizeSuccessPortResult>;

  finalizeFailure(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    errorCode: NativeLiveRuntimeFailureCode | "RUNTIME_PROTOCOL_ERROR";
    runtimeMetadata: NativeLiveRuntimeMetadata | null;
  }): Promise<NativeLiveFinalizeFailurePortResult>;

  discardWake?(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    providerSessionId: string | null;
  }): Promise<"discarded" | "idempotent">;
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
          ...(request.input_mode === "voice" ? { inputMode: "voice" as const } : {}),
          ...(request.interaction_mode === "live_call" ? { interactionMode: "live_call" as const } : {}),
          attachmentIds: request.attachment_ids ?? [],
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

    try {
      const command = nativeLiveRuntimeCommandFromPreparation(
        preparation,
        result.protocol_version,
      );
      if ((preparation.parentProviderCheckpointId !== undefined || preparation.runtimeMode === "resume") && result.status === "success" && !result.provider_checkpoint_id) {
        throw new NativeLiveRuntimeProtocolError("Checkpoint-addressed turn cannot accept a legacy result.");
      }
      assertRuntimeResultMatchesCommand(command, result);
    } catch (error) {
      if (error instanceof NativeLiveRuntimeProtocolError) {
        return failureForResult(result, "RESULT_MISMATCH");
      }
      return failureForResult(result, "INTERNAL_ERROR");
    }

    if (result.status === "failure") {
      if (preparation.operation === "wake") {
        const providerSessionId =
          wakeFailureProviderSessionId(
            result.runtime_metadata ?? null,
            preparation.parentProviderSessionId,
          );
        try {
          await this.discardWake({
            userId,
            preparation,
            providerSessionId,
          });
          return {
            ok: true,
            outcome: "wake_failed",
            requestId: preparation.requestId,
            operation: "wake",
            conversationId: preparation.conversationId,
            providerSessionId,
          };
        } catch {
          return failureForResult(result, "INTERNAL_ERROR");
        }
      }
      try {
        const recorded = await this.port.finalizeFailure({
          userId,
          preparation,
          errorCode: result.error_code,
          runtimeMetadata:
            result.runtime_metadata ?? null,
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
      if (preparation.operation === "wake") {
        try {
          await this.discardWake({
            userId,
            preparation,
            providerSessionId: result.provider_session_id,
          });
          return {
            ok: true,
            outcome: "wake_failed",
            requestId: preparation.requestId,
            operation: "wake",
            conversationId: preparation.conversationId,
            providerSessionId: result.provider_session_id,
          };
        } catch {
          return failureForResult(result, "INTERNAL_ERROR");
        }
      }
      try {
        const recorded = await this.port.finalizeFailure({
          userId,
          preparation,
          errorCode: "RUNTIME_PROTOCOL_ERROR",
          runtimeMetadata:
            result.runtime_metadata ?? null,
        });
        if (!recorded.ok) {
          return failureForResult(result, recorded.code);
        }
      } catch {
        return failureForResult(result, "INTERNAL_ERROR");
      }
      return failureForResult(result, "RUNTIME_PROTOCOL_ERROR");
    }

    if (
      preparation.operation === "wake"
      && isQuietWakeResult(result.normalized_events, canonical.blocks)
    ) {
      try {
        await this.discardWake({
          userId,
          preparation,
          providerSessionId: result.provider_session_id,
        });
        return {
          ok: true,
          outcome: "wake_quiet",
          requestId: preparation.requestId,
          operation: "wake",
          conversationId: preparation.conversationId,
          providerSessionId: result.provider_session_id,
        };
      } catch {
        return failureForResult(result, "INTERNAL_ERROR");
      }
    }

    const murmur = extractNativeLiveMurmur(canonical.blocks);
    const parsedMind = this.mind
      ? this.mind.parseAssistantBlocks(murmur.visibleBlocks)
      : {
          visibleBlocks: murmur.visibleBlocks,
          intents: [],
          actions: [],
        };
    const finalizedBlocks = murmur.murmurBlock
      ? [...parsedMind.visibleBlocks, murmur.murmurBlock]
      : parsedMind.visibleBlocks;

    let finalized: NativeLiveFinalizeSuccessPortResult;
    try {
      finalized = await this.port.finalizeSuccess({
        userId,
        preparation,
        providerSessionId: result.provider_session_id,
        effectiveWorkingDirectory: result.effective_working_directory,
        providerCheckpointId: result.provider_checkpoint_id ?? null,
        blocks: finalizedBlocks,
        outputAttachmentIds:
          result.output_attachment_ids ?? [],
        ...(result.output_attachment_metadata === undefined
          ? {}
          : {
              outputAttachmentMetadata:
                result.output_attachment_metadata,
            }),
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
    if (finalized.outcome === "wake_discarded") {
      return {
        ok: true,
        outcome: "wake_stale",
        requestId: preparation.requestId,
        operation: "wake",
        conversationId: preparation.conversationId,
        providerSessionId: result.provider_session_id,
      };
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

  private discardWake(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    providerSessionId: string | null;
  }): Promise<"discarded" | "idempotent"> {
    if (!this.port.discardWake) {
      throw new Error("Silence wake discard port is unavailable.");
    }
    return this.port.discardWake(input);
  }
}

export function nativeLiveRuntimeCommandFromPreparation(
  preparation: NativeLivePreparedTurn,
  protocolVersion: NativeLiveRuntimeCommand["protocol_version"] =
    NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
  outputAttachmentsEnabled = true,
): NativeLiveRuntimeCommand {
  const attachments = preparation.attachments ?? [];
  const command: NativeLiveRuntimeCommand = {
    protocol_version: protocolVersion,
    ...(outputAttachmentsEnabled ? {} : { output_attachments_enabled: false }),
    dispatch_target: "claude_code",
    prepare_id: preparation.prepareId,
    request_id: preparation.requestId,
    operation: preparation.operation,
    conversation_id: preparation.conversationId,
    canonical_user_message_id: preparation.canonicalUserMessageId,
    runtime_mode: preparation.runtimeMode,
    parent_provider_session_id: preparation.parentProviderSessionId,
    expected_working_directory:
      preparation.expectedWorkingDirectory ?? null,
    ...(preparation.parentProviderCheckpointId !== undefined ? { parent_provider_checkpoint_id: preparation.parentProviderCheckpointId } : {}),
    ...(preparation.failedUserMessageUuids?.length ? { failed_user_message_uuids: [...preparation.failedUserMessageUuids] } : {}),
    execution_selection: preparation.executionSelection ?? null,
    ...(attachments.length > 0
      ? { attachments }
      : {}),
    prompt: preparation.prompt,
  };
  return command;
}

function wakeFailureProviderSessionId(
  metadata: NativeLiveRuntimeMetadata | null,
  parentProviderSessionId: string | null,
): string | null {
  const candidate = metadata?.session_store?.session_id;
  return (
    typeof candidate === "string"
    && candidate.trim().length > 0
    && candidate !== parentProviderSessionId
  )
    ? candidate
    : null;
}

function isQuietWakeResult(
  events: readonly NativeLiveNormalizedEvent[],
  blocks: readonly NativeLiveContentBlockInput[],
): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "result") continue;
    const finalText = event.payload?.final_text;
    if (typeof finalText === "string") {
      const trimmed = finalText.trim();
      if (trimmed === "<quiet />") return true;
      if (trimmed.length > 0) return false;
      // A successful wake with an actually empty terminal response may be the
      // provider representation of "say nothing". Fall through to canonical
      // blocks so an empty wake can still be discarded instead of persisted.
      break;
    }
  }
  const nonTextBlocks = blocks.filter((block) => block.kind !== "text");
  if (nonTextBlocks.length > 0) return false;
  const text = blocks
    .filter((block) => block.kind === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text === "<quiet />" || text.length === 0;
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
