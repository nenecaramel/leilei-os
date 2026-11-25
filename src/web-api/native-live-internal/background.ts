import type { RequestHandler } from "express";
import type { NativeLiveRelayInternalDependencies } from "./dependencies.js";
import {
  requireInternalUser,
  sendInvalid,
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
