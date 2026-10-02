import type {
  RequestHandler,
  Response,
} from "express";
import { NativeLiveRuntimeControlError } from "../../domains/bridge/native-live-runtime-control.js";
import type { NativeLiveRelayInternalDependencies } from "./dependencies.js";
import {
  requireInternalUser,
  parseReservationId,
  parseListenerOnlyBody,
  sendInvalid,
  exactRecord,
  isUuid,
} from "./http.js";

export function waitRuntimeControlHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.runtimeControlService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseListenerOnlyBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const lease = await dependencies.relayService.renewLease({
        userId,
        listenerInstanceId: body.listener_instance_id,
        dispatchTarget: "claude_code",
      });
      if (lease === "busy") {
        response.status(409).json({
          success: false,
          error: {
            code: "RESERVATION_CONFLICT",
            message: "Native live listener lease is no longer owned by this daemon.",
          },
        });
        return;
      }

      const controller = new AbortController();
      const onClose = () => controller.abort();
      response.once("close", onClose);
      try {
        const result =
          await dependencies.runtimeControlService.waitNextForListener({
            userId,
            listenerInstanceId: body.listener_instance_id,
            reservationId,
            timeoutMs: 25_000,
            signal: controller.signal,
          });
        if (!response.writableEnded && !controller.signal.aborted) {
          response.json({
            success: true,
            data: result,
          });
        }
      } finally {
        response.off("close", onClose);
      }
    } catch (error) {
      if (response.writableEnded) return;
      sendRuntimeControlError(response, error);
    }
  };
}

export function completeRuntimeControlHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.runtimeControlService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const controlId =
      parseReservationId(request.params.controlId);
    const body = parseRuntimeControlCompletionBody(request.body);
    if (!reservationId || !controlId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const outcome =
        await dependencies.runtimeControlService.completeForListener({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          controlId,
          outcome: body.outcome,
        });
      response.json({
        success: true,
        data: { outcome },
      });
    } catch (error) {
      sendRuntimeControlError(response, error);
    }
  };
}

function parseRuntimeControlCompletionBody(
  value: unknown,
): {
  listener_instance_id: string;
  outcome:
    | {
        status: "applied";
        receipt: Record<string, unknown>;
      }
    | {
        status: "failed";
        failureCode: string;
      };
} | null {
  const record = exactRecord(value, [
    "listener_instance_id",
    "outcome",
  ]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || !record.outcome
    || typeof record.outcome !== "object"
    || Array.isArray(record.outcome)
  ) {
    return null;
  }
  const outcome = record.outcome as Record<string, unknown>;
  if (
    outcome.status === "applied"
    && Object.keys(outcome).length === 2
    && outcome.receipt
    && typeof outcome.receipt === "object"
    && !Array.isArray(outcome.receipt)
  ) {
    return {
      listener_instance_id: record.listener_instance_id,
      outcome: {
        status: "applied",
        receipt: outcome.receipt as Record<string, unknown>,
      },
    };
  }
  if (
    outcome.status === "failed"
    && Object.keys(outcome).length === 2
    && typeof outcome.failureCode === "string"
  ) {
    return {
      listener_instance_id: record.listener_instance_id,
      outcome: {
        status: "failed",
        failureCode: outcome.failureCode,
      },
    };
  }
  return null;
}

function sendRuntimeControlError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveRuntimeControlError) {
    const status =
      error.code === "CONTROL_INVALID"
        ? 400
        : error.code === "CONTROL_NOT_FOUND"
          ? 404
          : 409;
    response.status(status).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_RUNTIME_CONTROL_UNAVAILABLE",
      message:
        "Native live runtime control is temporarily unavailable.",
    },
  });
}
