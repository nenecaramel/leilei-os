import type { RequestHandler } from "express";
import { NativeLiveRuntimeEventError } from "../../domains/bridge/native-live-runtime-event-stream.js";
import type { NativeLiveNormalizedEvent } from "../../domains/conversation/native-live-conversation-orchestrator.js";
import type { NativeLiveRelayInternalDependencies } from "./dependencies.js";
import {
  requireInternalUser,
  parseReservationId,
  sendInvalid,
  exactRecord,
  isUuid,
} from "./http.js";

export function appendRuntimeEventBatchHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.runtimeEventService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseRuntimeEventBatchBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const outcome =
        await dependencies.runtimeEventService.appendBatch({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          events: body.events,
        });
      response.status(outcome.created > 0 ? 201 : 200).json({
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

function parseRuntimeEventBatchBody(
  value: unknown,
): {
  listener_instance_id: string;
  events: Array<{
    sequence: number;
    event: NativeLiveNormalizedEvent;
  }>;
} | null {
  const record = exactRecord(value, [
    "listener_instance_id",
    "events",
  ]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || !Array.isArray(record.events)
    || record.events.length < 1
    || record.events.length > 32
  ) {
    return null;
  }

  const events: Array<{
    sequence: number;
    event: NativeLiveNormalizedEvent;
  }> = [];
  for (const item of record.events) {
    const eventRecord = exactRecord(item, [
      "sequence",
      "event",
    ]);
    if (
      !eventRecord
      || !Number.isInteger(eventRecord.sequence)
      || (eventRecord.sequence as number) < 1
      || !eventRecord.event
      || typeof eventRecord.event !== "object"
      || Array.isArray(eventRecord.event)
    ) {
      return null;
    }
    events.push({
      sequence: eventRecord.sequence as number,
      event:
        eventRecord.event as NativeLiveNormalizedEvent,
    });
  }

  return {
    listener_instance_id: record.listener_instance_id,
    events,
  };
}
