import type {
  RequestHandler,
  Response,
} from "express";
import { NativeLiveRuntimeInteractionError } from "../../domains/bridge/runtime-interaction/native-live-runtime-interaction.js";
import type { NativeLiveRelayInternalDependencies } from "./dependencies.js";
import {
  requireInternalUser,
  parseReservationId,
  sendInvalid,
  parseListenerOnlyBody,
  exactRecord,
  isUuid,
} from "./http.js";

export function createRuntimeInteractionHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.runtimeInteractionService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseRuntimeInteractionCreateBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const result =
        await dependencies.runtimeInteractionService.create({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          interactionId: body.interaction_id,
          kind: body.kind,
          request: body.request,
        });
      response.status(result.outcome === "created" ? 201 : 200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      sendRuntimeInteractionError(response, error);
    }
  };
}

export function waitRuntimeInteractionHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.runtimeInteractionService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const interactionId =
      parseReservationId(request.params.interactionId);
    const body = parseListenerOnlyBody(request.body);
    if (!reservationId || !interactionId || !body) {
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
          await dependencies.runtimeInteractionService.waitForListener({
            userId,
            listenerInstanceId: body.listener_instance_id,
            reservationId,
            interactionId,
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
      sendRuntimeInteractionError(response, error);
    }
  };
}

export function cancelRuntimeInteractionHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.runtimeInteractionService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const interactionId =
      parseReservationId(request.params.interactionId);
    const body = parseListenerOnlyBody(request.body);
    if (!reservationId || !interactionId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const outcome =
        await dependencies.runtimeInteractionService.cancelForListener({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          interactionId,
        });
      response.json({
        success: true,
        data: { outcome },
      });
    } catch (error) {
      sendRuntimeInteractionError(response, error);
    }
  };
}

function parseRuntimeInteractionCreateBody(
  value: unknown,
): {
  listener_instance_id: string;
  interaction_id: string;
  kind: "permission" | "question";
  request: Record<string, unknown>;
} | null {
  const record = exactRecord(value, [
    "listener_instance_id",
    "interaction_id",
    "kind",
    "request",
  ]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || !isUuid(record.interaction_id)
    || (record.kind !== "permission" && record.kind !== "question")
    || !record.request
    || typeof record.request !== "object"
    || Array.isArray(record.request)
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    interaction_id: record.interaction_id,
    kind: record.kind,
    request: record.request as Record<string, unknown>,
  };
}

function sendRuntimeInteractionError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveRuntimeInteractionError) {
    const status =
      error.code === "INTERACTION_INVALID"
        ? 400
        : error.code === "INTERACTION_NOT_FOUND"
          || error.code === "RESERVATION_NOT_FOUND"
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
      code: "NATIVE_LIVE_RUNTIME_INTERACTION_UNAVAILABLE",
      message:
        "Native live runtime interaction is temporarily unavailable.",
    },
  });
}
