import type { RequestHandler, Response } from "express";
import {
  NativeLiveFailedTurnRecoveryError,
} from "../../domains/bridge/turn/native-live-failed-turn-recovery.js";
import type {
  NativeLiveRelayInternalDependencies,
} from "./dependencies.js";
import {
  parseReservationId,
  requireInternalUser,
  sendInvalid,
} from "./http.js";

export function inspectFailedTurnRecoveryHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.failedTurnRecoveryService) return;
    const prepareId = parseReservationId(request.params.prepareId);
    if (!prepareId) {
      sendInvalid(response);
      return;
    }
    try {
      const inspection =
        await dependencies.failedTurnRecoveryService.inspect({
          userId,
          prepareId,
        });
      response.json({ success: true, data: inspection });
    } catch (error) {
      sendRecoveryError(response, error);
    }
  };
}

export function recoverFailedTurnHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.failedTurnRecoveryService) return;
    const prepareId = parseReservationId(request.params.prepareId);
    if (!prepareId) {
      sendInvalid(response);
      return;
    }
    try {
      const recovered =
        await dependencies.failedTurnRecoveryService.recover({
          userId,
          prepareId,
        });
      response.json({ success: true, data: recovered });
    } catch (error) {
      sendRecoveryError(response, error);
    }
  };
}

function sendRecoveryError(
  response: Response,
  error: unknown,
): void {
  if (!(error instanceof NativeLiveFailedTurnRecoveryError)) {
    response.status(503).json({
      success: false,
      error: {
        code: "FAILED_TURN_RECOVERY_UNAVAILABLE",
        message: "Failed turn recovery is temporarily unavailable.",
      },
    });
    return;
  }
  const status =
    error.code === "NOT_FOUND"
      ? 404
      : error.code === "SESSION_NOT_COMPLETE"
        || error.code === "CHECKPOINT_NOT_FOUND"
        ? 409
        : error.code === "STALE_HEAD"
          || error.code === "CONFLICT"
          || error.code === "NOT_RECOVERABLE"
            ? 409
            : 503;
  response.status(status).json({
    success: false,
    error: {
      code: error.code,
      message: error.message,
    },
  });
}
