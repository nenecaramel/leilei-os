import type {
  RequestHandler,
  Response,
} from "express";
import type {
  NativeLiveRelayInternalDependencies,
} from "./dependencies.js";

export function readSilenceWakeScheduleHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(
      response,
      request.mcpUserId,
    );
    if (!userId || !dependencies.silenceWakeService) return;

    try {
      const schedule =
        await dependencies.silenceWakeService.readSchedule({
          userId,
        });
      response.json({
        success: true,
        data: schedule,
      });
    } catch (error) {
      logSilenceWakeFailure("schedule", error);
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_SILENCE_WAKE_UNAVAILABLE",
          message:
            "Silence wake schedule is temporarily unavailable.",
        },
      });
    }
  };
}

export function fireSilenceWakeHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(
      response,
      request.mcpUserId,
    );
    if (!userId || !dependencies.silenceWakeService) return;

    const body = parseFireBody(request.body);
    if (!body) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid silence wake request.",
        },
      });
      return;
    }

    try {
      const result = await dependencies.silenceWakeService.fire({
        userId,
        epochId: body.epoch_id,
        slot: body.slot,
      });
      response.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logSilenceWakeFailure("fire", error);
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_SILENCE_WAKE_UNAVAILABLE",
          message:
            "Silence wake opportunity is temporarily unavailable.",
        },
      });
    }
  };
}

function logSilenceWakeFailure(
  action: "schedule" | "fire",
  error: unknown,
): void {
  const record =
    error && typeof error === "object"
      ? error as Record<string, unknown>
      : {};
  const cause = errorRecord(record.cause);
  process.stderr.write(
    JSON.stringify({
      level: "error",
      timestamp: new Date().toISOString(),
      event: "native_live_silence_wake_failed",
      action,
      errorName:
        error instanceof Error
          ? error.name
          : "UnknownError",
      ...(
        error instanceof Error && error.message
          ? { errorMessage: diagnosticText(error.message) }
          : {}
      ),
      ...(
        typeof record.code === "string"
          ? { errorCode: record.code }
          : {}
      ),
      ...(
        typeof record.detail === "string"
          ? { errorDetail: diagnosticText(record.detail) }
          : {}
      ),
      ...(
        typeof record.constraint_name === "string"
          ? { errorConstraint: diagnosticText(record.constraint_name) }
          : typeof record.constraint === "string"
            ? { errorConstraint: diagnosticText(record.constraint) }
            : {}
      ),
      ...(
        cause
          ? {
              causeName:
                typeof cause.name === "string"
                  ? cause.name
                  : undefined,
              causeCode:
                typeof cause.code === "string"
                  ? cause.code
                  : undefined,
              causeMessage:
                typeof cause.message === "string"
                  ? diagnosticText(cause.message)
                  : undefined,
            }
          : {}
      ),
    }) + "\n",
  );
}

function diagnosticText(value: string): string {
  return value.length <= 500
    ? value
    : value.slice(0, 497) + "...";
}

function errorRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function parseFireBody(value: unknown): {
  epoch_id: string;
  slot: "post_turn_idle" | "long_idle";
} | null {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2
    || keys[0] !== "epoch_id"
    || keys[1] !== "slot"
    || typeof record.epoch_id !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(record.epoch_id)
    || (
      record.slot !== "post_turn_idle"
      && record.slot !== "long_idle"
    )
  ) {
    return null;
  }
  return {
    epoch_id: record.epoch_id,
    slot: record.slot,
  };
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
      message: "Authentication required.",
    },
  });
  return null;
}
