import { randomUUID } from "node:crypto";
import type {
  NativeLiveBackendMindRuntime,
} from "./native-live-backend-mind-runtime.js";
import {
  nativeLiveRuntimeCommandFromPreparation,
  type NativeLiveBackendTurnPort,
  type NativeLivePrepareFailureCode,
  type NativeLivePreparePortResult,
} from "./native-live-backend-turn-coordinator.js";
import {
  NativeLiveRelayContractError,
  parseNativeLiveRelayRequest,
  type NativeLiveRelayRequest,
} from "./native-live-relay-contract.js";
import type {
  NativeLiveRuntimeCommand,
} from "./native-live-runtime-protocol.js";
import type {
  NativeLiveSemanticPreparationStager,
} from "./native-live-semantic-handshake.js";

export type NativeLiveRelayPrepareResult =
  | {
      ok: true;
      outcome: "created" | "replayed";
      semanticPending: boolean;
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

export class NativeLiveBackendRelayPrepareCoordinator {
  constructor(
    private readonly port: NativeLiveBackendTurnPort,
    private readonly mind: NativeLiveBackendMindRuntime | null,
    private readonly semantic: NativeLiveSemanticPreparationStager | null,
    private readonly createPrepareId: () => string = randomUUID,
  ) {}

  async prepare(
    userId: string,
    rawRequest: unknown,
  ): Promise<NativeLiveRelayPrepareResult> {
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

    let prepared: NativeLivePreparePortResult;
    try {
      const prepareId = this.createPrepareId();
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
      return failureFromRequest(request, "INTERNAL_ERROR");
    }

    if (!prepared.ok) {
      return {
        ...failureFromRequest(request, prepared.code),
        ...(prepared.currentHeadMessageId !== undefined
          ? { currentHeadMessageId: prepared.currentHeadMessageId }
          : {}),
      };
    }

    let preparation = prepared.preparation;
    if (this.mind && !preparation.mindPrepared) {
      try {
        if (
          this.semantic
          && this.mind.planSemanticPrompt
          && this.mind.completeSemanticPrompt
        ) {
          const stagedPlan = this.semantic.readPlan
            ? await this.semantic.readPlan({
                userId,
                prepareId: preparation.prepareId,
              })
            : null;
          if (stagedPlan) {
            return {
              ok: true,
              outcome: prepared.outcome,
              semanticPending: true,
              command: nativeLiveRuntimeCommandFromPreparation(preparation),
            };
          }

          const plan = await this.mind.planSemanticPrompt({
            userId,
            preparation,
          });
          if (plan) {
            await this.semantic.stage({
              userId,
              preparation,
              plan,
            });
            return {
              ok: true,
              outcome: prepared.outcome,
              semanticPending: true,
              command: nativeLiveRuntimeCommandFromPreparation(preparation),
            };
          }
        }

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
        return failureFromRequest(request, "INTERNAL_ERROR");
      }
    }

    return {
      ok: true,
      outcome: prepared.outcome,
      semanticPending: false,
      command: nativeLiveRuntimeCommandFromPreparation(preparation),
    };
  }
}

function failureFromRequest(
  request: NativeLiveRelayRequest,
  code: NativeLivePrepareFailureCode,
): Extract<NativeLiveRelayPrepareResult, { ok: false }> {
  return {
    ok: false,
    requestId: request.request_id,
    operation: request.operation,
    conversationId: request.conversation_id,
    code,
  };
}

function readStringField(input: unknown, field: string): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

function readOperation(
  input: unknown,
): NativeLiveRelayRequest["operation"] | null {
  const value = readStringField(input, "operation");
  return value === "send" || value === "retry" || value === "edit"
    ? value
    : null;
}
