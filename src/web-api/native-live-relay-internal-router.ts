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
import {
  NativeLiveSemanticHandshakeError,
  type NativeLiveSemanticFallbackCode,
  type NativeLiveSemanticHandshakeService,
} from "../domains/bridge/native-live-semantic-handshake.js";
import {
  NativeLiveBackgroundModelQueueError,
  type NativeLiveBackgroundModelQueueService,
} from "../domains/bridge/native-live-background-model-queue.js";
import {
  parseNativeLiveBackgroundModelExecutionResult,
  type NativeLiveBackgroundModelExecutionResult,
} from "../domains/bridge/native-live-background-model-protocol.js";
import type {
  NativeLiveBackgroundWorkflowCoordinator,
} from "../domains/bridge/native-live-background-workflow-coordinator.js";
import type {
  TopicResurfaceCrossDeviceOpportunity,
} from "../domains/runtime/topic-resurface-cross-device-opportunity.js";
import {
  NativeLiveRuntimeEventError,
  type NativeLiveRuntimeEventService,
} from "../domains/bridge/native-live-runtime-event-stream.js";
import type {
  NativeLiveNormalizedEvent,
} from "../domains/conversation/native-live-conversation-orchestrator.js";

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
  semanticService?: Pick<
    NativeLiveSemanticHandshakeService,
    "reserveNext" | "submitScores" | "submitFallback"
  >;
  backgroundModelService?: Pick<
    NativeLiveBackgroundModelQueueService,
    "reserveNext" | "submitResult"
  >;
  backgroundModelCoordinator?: Pick<
    NativeLiveBackgroundWorkflowCoordinator,
    "advanceNextForUser"
  >;
  backgroundModelOpportunity?: Pick<
    TopicResurfaceCrossDeviceOpportunity,
    "offer"
  >;
  runtimeEventService?: Pick<
    NativeLiveRuntimeEventService,
    "append"
  >;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createNativeLiveRelayInternalRouter(
  dependencies: NativeLiveRelayInternalDependencies,
): Router {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.post("/lease/renew", renewLeaseHandler(dependencies));
  if (dependencies.semanticService) {
    router.post(
      "/semantic/reserve",
      reserveSemanticHandler(dependencies),
    );
    router.post(
      "/semantic/reservations/:reservationId/scores",
      submitSemanticScoresHandler(dependencies),
    );
    router.post(
      "/semantic/reservations/:reservationId/fallback",
      submitSemanticFallbackHandler(dependencies),
    );
  }
  if (dependencies.backgroundModelService) {
    router.post(
      "/background-model/reserve",
      reserveBackgroundModelHandler(dependencies),
    );
    router.post(
      "/background-model/reservations/:reservationId/result",
      submitBackgroundModelResultHandler(dependencies),
    );
    router.post(
      "/background-model/topic-resurface/opportunity",
      topicResurfaceOpportunityHandler(dependencies),
    );
  }
  router.post("/reserve", reserveNextHandler(dependencies));
  router.post(
    "/reservations/:reservationId/execution-started",
    executionStartedHandler(dependencies),
  );
  if (dependencies.runtimeEventService) {
    router.post(
      "/reservations/:reservationId/events",
      appendRuntimeEventHandler(dependencies),
    );
  }
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

function reserveSemanticHandler(
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

function submitSemanticScoresHandler(
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

function submitSemanticFallbackHandler(
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

function topicResurfaceOpportunityHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.backgroundModelService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    if (!dependencies.backgroundModelOpportunity) {
      response.json({
        success: true,
        data: { outcome: "disabled" },
      });
      return;
    }

    try {
      const result =
        await dependencies.backgroundModelOpportunity.offer({
          userId,
        });
      response.json({
        success: true,
        data: result,
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_TOPIC_RESURFACE_OPPORTUNITY_UNAVAILABLE",
          message:
            "Topic resurface background opportunity is temporarily unavailable.",
        },
      });
    }
  };
}

function reserveBackgroundModelHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.backgroundModelService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      await bestEffortAdvanceBackgroundWorkflow(
        dependencies,
        userId,
      );
      const reservation =
        await dependencies.backgroundModelService.reserveNext({
          userId,
          listenerInstanceId: body.listener_instance_id,
        });
      response.json({
        success: true,
        data: reservation,
      });
    } catch (error) {
      sendBackgroundModelError(response, error);
    }
  };
}

function submitBackgroundModelResultHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.backgroundModelService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseBackgroundModelResultBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.backgroundModelService.submitResult({
        userId,
        listenerInstanceId: body.listener_instance_id,
        taskId: reservationId,
        result: body.result,
      });
      await bestEffortAdvanceBackgroundWorkflow(
        dependencies,
        userId,
      );
      response.json({
        success: true,
        data: { accepted: true },
      });
    } catch (error) {
      sendBackgroundModelError(response, error);
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

function appendRuntimeEventHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.runtimeEventService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseRuntimeEventBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const outcome =
        await dependencies.runtimeEventService.append({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          sequence: body.sequence,
          event: body.event,
        });
      response.status(outcome === "created" ? 201 : 200).json({
        success: true,
        data: { outcome },
      });
    } catch (error) {
      if (error instanceof NativeLiveRuntimeEventError) {
        const status =
          error.code === "INVALID_EVENT"
            ? 400
            : error.code === "RESERVATION_NOT_FOUND"
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
          code: "NATIVE_LIVE_RUNTIME_EVENT_UNAVAILABLE",
          message:
            "Native live runtime event persistence is temporarily unavailable.",
        },
      });
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

function parseRuntimeEventBody(
  value: unknown,
): {
  listener_instance_id: string;
  sequence: number;
  event: NativeLiveNormalizedEvent;
} | null {
  const record = exactRecord(value, [
    "listener_instance_id",
    "sequence",
    "event",
  ]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || !Number.isInteger(record.sequence)
    || (record.sequence as number) < 1
    || !record.event
    || typeof record.event !== "object"
    || Array.isArray(record.event)
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    sequence: record.sequence as number,
    event: record.event as NativeLiveNormalizedEvent,
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

function parseBackgroundModelResultBody(
  value: unknown,
): {
  listener_instance_id: string;
  result: NativeLiveBackgroundModelExecutionResult;
} | null {
  const record = exactRecord(value, [
    "listener_instance_id",
    "result",
  ]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
  ) {
    return null;
  }

  try {
    return {
      listener_instance_id: record.listener_instance_id,
      result: parseNativeLiveBackgroundModelExecutionResult(
        record.result,
      ),
    };
  } catch {
    return null;
  }
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

async function bestEffortAdvanceBackgroundWorkflow(
  dependencies: NativeLiveRelayInternalDependencies,
  userId: string,
): Promise<void> {
  try {
    await dependencies.backgroundModelCoordinator?.advanceNextForUser({
      userId,
    });
  } catch {
    // A terminal result is already durable. Recovery happens on the next
    // reserve call; workflow advancement must not turn delivery into failure.
  }
}

function sendBackgroundModelError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveBackgroundModelQueueError) {
    response.status(409).json({
      success: false,
      error: {
        code: error.code,
        message:
          error.code === "LISTENER_NOT_ACTIVE"
            ? "Native live background listener lease is not active."
            : "Native live background model reservation is no longer valid.",
      },
    });
    return;
  }

  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_BACKGROUND_MODEL_UNAVAILABLE",
      message:
        "Native live background model queue is temporarily unavailable.",
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
