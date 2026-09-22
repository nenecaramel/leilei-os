import { Router, type RequestHandler, type Response } from "express";
import {
  NativeLiveBackendRelayError,
  type NativeLiveBackendRelayService,
} from "../domains/bridge/native-live-backend-relay.js";
import type {
  NativeLiveDaemonRejectCode,
} from "../domains/bridge/native-live-mac-daemon-loop.js";
import type {
  NativeLiveRuntimeExecutionResult,
} from "../domains/bridge/native-live-runtime-protocol.js";

export type NativeLiveRelayInternalDependencies = {
  relayService: Pick<
    NativeLiveBackendRelayService,
    | "renewLease"
    | "reserveNext"
    | "markExecutionStarted"
    | "submitResult"
    | "markResultDeliveryUnknown"
    | "rejectReservation"
  >;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createNativeLiveRelayInternalRouter(
  dependencies: NativeLiveRelayInternalDependencies,
): Router {
  const router = Router();
  router.post("/lease/renew", renewLeaseHandler(dependencies));
  router.post("/reserve", reserveNextHandler(dependencies));
  router.post(
    "/reservations/:reservationId/execution-started",
    executionStartedHandler(dependencies),
  );
  router.post(
    "/reservations/:reservationId/result",
    submitResultHandler(dependencies),
  );
  router.post(
    "/reservations/:reservationId/delivery-unknown",
    deliveryUnknownHandler(dependencies),
  );
  router.post(
    "/reservations/:reservationId/reject",
    rejectReservationHandler(dependencies),
  );
  return router;
}

function renewLeaseHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      const state = await dependencies.relayService.renewLease({
        userId,
        listenerInstanceId: body.listener_instance_id,
        dispatchTarget: "claude_code",
      });
      response.json({ success: true, data: { state } });
    } catch (error) {
      sendRelayError(response, error);
    }
  };
}

function reserveNextHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      const reservation = await dependencies.relayService.reserveNext({
        userId,
        listenerInstanceId: body.listener_instance_id,
        dispatchTarget: "claude_code",
      });
      response.json({
        success: true,
        data: reservation
          ? {
              reservationId: reservation.reservationId,
              command: reservation.command,
            }
          : null,
      });
    } catch (error) {
      sendRelayError(response, error);
    }
  };
}

function executionStartedHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseListenerOnlyBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.relayService.markExecutionStarted({
        userId,
        listenerInstanceId: body.listener_instance_id,
        reservationId,
      });
      response.json({ success: true, data: { accepted: true } });
    } catch (error) {
      sendRelayError(response, error);
    }
  };
}

function submitResultHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseResultBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const finalized = await dependencies.relayService.submitResult({
        userId,
        listenerInstanceId: body.listener_instance_id,
        reservationId,
        result: body.result,
      });
      response.json({
        success: true,
        data: {
          accepted: true,
          canonicalOutcome: finalized.ok
            ? finalized.outcome
            : finalized.code,
        },
      });
    } catch (error) {
      sendRelayError(response, error);
    }
  };
}

function deliveryUnknownHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseListenerOnlyBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.relayService.markResultDeliveryUnknown({
        userId,
        listenerInstanceId: body.listener_instance_id,
        reservationId,
      });
      response.json({ success: true, data: { accepted: true } });
    } catch (error) {
      sendRelayError(response, error);
    }
  };
}

function rejectReservationHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseRejectBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.relayService.rejectReservation({
        userId,
        listenerInstanceId: body.listener_instance_id,
        reservationId,
        code: body.code,
      });
      response.json({ success: true, data: { accepted: true } });
    } catch (error) {
      sendRelayError(response, error);
    }
  };
}

function parseListenerBody(
  value: unknown,
): { listener_instance_id: string; dispatch_target: "claude_code" } | null {
  const record = exactRecord(value, ["listener_instance_id", "dispatch_target"]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || record.dispatch_target !== "claude_code"
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    dispatch_target: "claude_code",
  };
}

function parseListenerOnlyBody(
  value: unknown,
): { listener_instance_id: string } | null {
  const record = exactRecord(value, ["listener_instance_id"]);
  if (!record || !isUuid(record.listener_instance_id)) return null;
  return { listener_instance_id: record.listener_instance_id };
}

function parseResultBody(
  value: unknown,
): {
  listener_instance_id: string;
  result: NativeLiveRuntimeExecutionResult;
} | null {
  const record = exactRecord(value, ["listener_instance_id", "result"]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || !record.result
    || typeof record.result !== "object"
    || Array.isArray(record.result)
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    result: record.result as NativeLiveRuntimeExecutionResult,
  };
}

function parseRejectBody(
  value: unknown,
): { listener_instance_id: string; code: NativeLiveDaemonRejectCode } | null {
  const record = exactRecord(value, ["listener_instance_id", "code"]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || (
      record.code !== "INVALID_COMMAND"
      && record.code !== "EXECUTION_START_FAILED"
    )
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    code: record.code,
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  if (
    actualKeys.length !== keys.length
    || actualKeys.some((key) => !keys.includes(key))
  ) {
    return null;
  }
  return record;
}

function parseReservationId(
  value: string | string[] | undefined,
): string | null {
  const id = Array.isArray(value) ? value[0] : value;
  return isUuid(id) ? id : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function requireInternalUser(
  response: Response,
  userId: string | undefined,
): string | null {
  if (userId) return userId;
  response.status(401).json({
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "A valid internal credential is required.",
    },
  });
  return null;
}

function sendInvalid(response: Response): void {
  response.status(400).json({
    success: false,
    error: {
      code: "INVALID_NATIVE_LIVE_RELAY_REQUEST",
      message: "Native live relay request is invalid.",
    },
  });
}

function sendRelayError(response: Response, error: unknown): void {
  if (error instanceof NativeLiveBackendRelayError) {
    const status =
      error.code === "LISTENER_BUSY"
        ? 409
        : error.code === "LISTENER_NOT_ACTIVE"
          ? 409
          : error.code === "RESERVATION_CONFLICT"
            ? 409
            : 503;
    response.status(status).json({
      success: false,
      error: {
        code: error.code,
        message:
          error.code === "LISTENER_BUSY"
            ? "Another native live listener owns the active lease."
            : error.code === "LISTENER_NOT_ACTIVE"
              ? "Native live listener lease is not active."
              : error.code === "RESERVATION_CONFLICT"
                ? "Native live reservation is no longer valid."
                : "Native live result finalization was rejected.",
      },
    });
    return;
  }

  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_RELAY_UNAVAILABLE",
      message: "Native live relay is temporarily unavailable.",
    },
  });
}
