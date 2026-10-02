import type {
  RequestHandler,
  Response,
} from "express";
import { NativeLiveBackgroundModelQueueError } from "../../domains/bridge/native-live-background-model-queue.js";
import {
  parseNativeLiveBackgroundModelExecutionResult,
  type NativeLiveBackgroundModelExecutionResult,
} from "../../domains/bridge/native-live-background-model-protocol.js";
import type { NativeLiveRelayInternalDependencies } from "./dependencies.js";
import {
  requireInternalUser,
  sendInvalid,
  parseListenerBody,
  parseReservationId,
  exactRecord,
  isUuid,
} from "./http.js";

export function companionBackgroundOpportunityHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.companionBackgroundOpportunity) return;
    const body = parseCompanionBackgroundOpportunityBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      const result =
        await dependencies.companionBackgroundOpportunity.offer({
          userId,
          reason: body.reason,
        });
      bestEffortObserveCompanionBackgroundOpportunity(
        dependencies,
        {
          outcome: "offered",
          reason: body.reason,
          maintenanceKindCount: result.maintenanceKinds.length,
          effectDeliveryScheduled: result.effectDeliveryScheduled,
          proactivityScheduled: result.proactivityScheduled,
          failureCount: result.failures.length,
        },
      );
      response.json({
        success: true,
        data: result,
      });
    } catch {
      bestEffortObserveCompanionBackgroundOpportunity(
        dependencies,
        {
          outcome: "failed",
          reason: body.reason,
          maintenanceKindCount: 0,
          effectDeliveryScheduled: false,
          proactivityScheduled: false,
          failureCount: 1,
        },
      );
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_COMPANION_BACKGROUND_UNAVAILABLE",
          message:
            "Companion background opportunity is temporarily unavailable.",
        },
      });
    }
  };
}

function bestEffortObserveCompanionBackgroundOpportunity(
  dependencies: NativeLiveRelayInternalDependencies,
  event: Parameters<
    NonNullable<
      NativeLiveRelayInternalDependencies[
        "observeCompanionBackgroundOpportunity"
      ]
    >
  >[0],
): void {
  try {
    dependencies.observeCompanionBackgroundOpportunity?.(event);
  } catch {
    // Acceptance observability must never affect runtime behavior.
  }
}

export function reserveBackgroundModelHandler(
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

export function submitBackgroundModelResultHandler(
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

function parseCompanionBackgroundOpportunityBody(
  value: unknown,
): {
  listener_instance_id: string;
  dispatch_target: "claude_code";
  reason: "startup" | "dirty" | "due";
} | null {
  const record = exactRecord(value, [
    "listener_instance_id",
    "dispatch_target",
    "reason",
  ]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || record.dispatch_target !== "claude_code"
    || (
      record.reason !== "startup"
      && record.reason !== "dirty"
      && record.reason !== "due"
    )
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    dispatch_target: "claude_code",
    reason: record.reason,
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
