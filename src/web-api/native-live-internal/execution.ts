import type {
  RequestHandler,
  Response,
} from "express";
import { NativeLiveBackendRelayError } from "../../domains/bridge/relay/native-live-backend-relay.js";
import type { NativeLiveDaemonRejectCode } from "../../domains/bridge/mac/native-live-mac-daemon-loop.js";
import type { NativeLiveRuntimeExecutionResult } from "../../domains/bridge/protocol/native-live-runtime-protocol.js";
import type { NativeLiveRelayInternalDependencies } from "./dependencies.js";
import {
  requireInternalUser,
  parseListenerBody,
  sendInvalid,
  parseReservationId,
  parseListenerOnlyBody,
  exactRecord,
  isUuid,
} from "./http.js";

export function renewLeaseHandler(
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

export function waitForWorkHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.workWaitService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
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
        response.json({
          success: true,
          data: { outcome: "busy" },
        });
        return;
      }

      const controller = new AbortController();
      const onClose = () => controller.abort();
      response.once("close", onClose);
      try {
        const result = await dependencies.workWaitService.wait({
          userId,
          timeoutMs: 45_000,
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
      if (error instanceof NativeLiveBackendRelayError) {
        sendRelayError(response, error);
        return;
      }
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_WORK_WAIT_UNAVAILABLE",
          message: "Native live work wait is temporarily unavailable.",
        },
      });
    }
  };
}

export function reserveNextHandler(
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
      if (reservation) {
        process.stdout.write(
          JSON.stringify({
            level: "info",
            timestamp: new Date().toISOString(),
            event: "native_live_reservation_dispatch_observed",
            reservationId: reservation.reservationId,
            protocolVersion: reservation.command.protocol_version,
            operation: reservation.command.operation,
            attachmentCount:
              reservation.command.attachments?.length ?? 0,
          }) + "\n",
        );
      }
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

export function executionStartedHandler(
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

export function submitResultHandler(
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
      logResultSubmissionFailure(
        reservationId,
        error,
      );
      sendRelayError(response, error);
    }
  };
}

export function deliveryUnknownHandler(
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

export function rejectReservationHandler(
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

function logResultSubmissionFailure(
  reservationId: string,
  error: unknown,
): void {
  const record =
    error && typeof error === "object"
      ? error as Record<string, unknown>
      : {};
  process.stderr.write(
    JSON.stringify({
      level: "error",
      timestamp: new Date().toISOString(),
      event: "native_live_result_submission_failed",
      reservationId,
      errorName:
        error instanceof Error
          ? error.name
          : "UnknownError",
      ...(
        typeof record.code === "string"
          ? { relayCode: record.code }
          : {}
      ),
      ...(
        typeof record.finalizeCode === "string"
          ? { finalizeCode: record.finalizeCode }
          : {}
      ),
    }) + "\n",
  );
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
        ...(error.finalizeCode
          ? { finalizeCode: error.finalizeCode }
          : {}),
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
