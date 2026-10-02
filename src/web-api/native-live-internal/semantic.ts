import type {
  RequestHandler,
  Response,
} from "express";
import {
  NativeLiveSemanticHandshakeError,
  type NativeLiveSemanticFallbackCode,
} from "../../domains/bridge/mind/native-live-semantic-handshake.js";
import type { NativeLiveRelayInternalDependencies } from "./dependencies.js";
import {
  requireInternalUser,
  parseListenerBody,
  sendInvalid,
  parseReservationId,
  exactRecord,
  isUuid,
} from "./http.js";

export function reserveSemanticHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.semanticService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      const reservation = await dependencies.semanticService.reserveNext({
        userId,
        listenerInstanceId: body.listener_instance_id,
      });
      response.json({
        success: true,
        data: reservation,
      });
    } catch (error) {
      sendSemanticError(response, error);
    }
  };
}

export function submitSemanticScoresHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.semanticService) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseSemanticScoresBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.semanticService.submitScores({
        userId,
        listenerInstanceId: body.listener_instance_id,
        prepareId: reservationId,
        scores: body.scores,
      });
      response.json({ success: true, data: { accepted: true } });
    } catch (error) {
      sendSemanticError(response, error);
    }
  };
}

export function submitSemanticFallbackHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.semanticService) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseSemanticFallbackBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.semanticService.submitFallback({
        userId,
        listenerInstanceId: body.listener_instance_id,
        prepareId: reservationId,
        code: body.code,
      });
      response.json({ success: true, data: { accepted: true } });
    } catch (error) {
      sendSemanticError(response, error);
    }
  };
}

function parseSemanticScoresBody(
  value: unknown,
): {
  listener_instance_id: string;
  scores: Record<string, number>;
} | null {
  const record = exactRecord(value, ["listener_instance_id", "scores"]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || !record.scores
    || typeof record.scores !== "object"
    || Array.isArray(record.scores)
  ) {
    return null;
  }

  const scores = record.scores as Record<string, unknown>;
  if (
    Object.keys(scores).length === 0
    || !Object.values(scores).every(
      (score) =>
        typeof score === "number"
        && Number.isFinite(score)
        && score >= 0
        && score <= 1,
    )
  ) {
    return null;
  }

  return {
    listener_instance_id: record.listener_instance_id,
    scores: scores as Record<string, number>,
  };
}

function parseSemanticFallbackBody(
  value: unknown,
): {
  listener_instance_id: string;
  code: NativeLiveSemanticFallbackCode;
} | null {
  const record = exactRecord(value, ["listener_instance_id", "code"]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || (
      record.code !== "E5_PROVIDER_UNAVAILABLE"
      && record.code !== "E5_SCORING_FAILED"
    )
  ) {
    return null;
  }

  return {
    listener_instance_id: record.listener_instance_id,
    code: record.code,
  };
}

function sendSemanticError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveSemanticHandshakeError) {
    const status =
      error.code === "SEMANTIC_SCORE_INVALID" ? 400 : 409;
    response.status(status).json({
      success: false,
      error: {
        code: error.code,
        message:
          error.code === "LISTENER_NOT_ACTIVE"
            ? "Native live semantic listener lease is not active."
            : error.code === "SEMANTIC_SCORE_INVALID"
              ? "Semantic score payload is invalid."
              : "Semantic scoring reservation is no longer valid.",
      },
    });
    return;
  }

  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_SEMANTIC_UNAVAILABLE",
      message: "Native live semantic scoring is temporarily unavailable.",
    },
  });
}
