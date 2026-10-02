import type { RequestHandler } from "express";
import { NativeLiveRuntimeInteractionError } from "../../domains/bridge/runtime-interaction/native-live-runtime-interaction.js";
import { NativeLiveRuntimeControlError } from "../../domains/bridge/runtime-interaction/native-live-runtime-control.js";
import type { NativeLiveApiDependencies } from "./dependencies.js";
import {
  requireWebUser,
  routeParam,
  UUID_PATTERN,
  exactBody,
} from "./http.js";

export function readNativeLiveRuntimeControlsHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const prepareId = routeParam(request.params.prepareId);
    if (!UUID_PATTERN.test(prepareId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_TURN_ID",
          message: "Native live turn id is invalid.",
        },
      });
      return;
    }
    const limit = parsePositiveInteger(request.query.limit, 50, 100);
    if (limit === null) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONTROL_LIMIT",
          message: "Runtime control limit must be 1-100.",
        },
      });
      return;
    }
    try {
      const controls =
        await dependencies.runtimeControlService!.listForUser({
          userId: request.webUserId,
          prepareId,
          limit,
        });
      if (controls === null) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_TURN_NOT_FOUND",
            message: "Native live turn was not found.",
          },
        });
        return;
      }
      response.setHeader("Cache-Control", "private, no-store");
      response.json({
        success: true,
        data: { prepareId, controls },
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_RUNTIME_CONTROLS_UNAVAILABLE",
          message:
            "Native live runtime controls are temporarily unavailable.",
        },
      });
    }
  };
}

export function createNativeLiveRuntimeControlHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const prepareId = routeParam(request.params.prepareId);
    const body = exactBody(request.body, [
      "control_id",
      "kind",
      "payload",
    ]);
    if (
      !UUID_PATTERN.test(prepareId)
      || !body
      || typeof body.control_id !== "string"
      || !UUID_PATTERN.test(body.control_id)
      || (
        body.kind !== "mid_turn_input"
        && body.kind !== "interrupt"
      )
      || !body.payload
      || typeof body.payload !== "object"
      || Array.isArray(body.payload)
    ) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_RUNTIME_CONTROL",
          message: "Native live runtime control is invalid.",
        },
      });
      return;
    }

    try {
      const result =
        await dependencies.runtimeControlService!.createForUser({
          userId: request.webUserId,
          prepareId,
          controlId: body.control_id,
          kind: body.kind,
          payload: body.payload as Record<string, unknown>,
        });
      response.status(result.outcome === "created" ? 201 : 200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error instanceof NativeLiveRuntimeControlError) {
        const status =
          error.code === "CONTROL_INVALID"
            ? 400
            : error.code === "CONTROL_NOT_FOUND"
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
          code: "NATIVE_LIVE_RUNTIME_CONTROL_UNAVAILABLE",
          message:
            "Native live runtime control is temporarily unavailable.",
        },
      });
    }
  };
}

export function readNativeLiveRuntimeInteractionsHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const prepareId = routeParam(request.params.prepareId);
    if (!UUID_PATTERN.test(prepareId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_TURN_ID",
          message: "Native live turn id is invalid.",
        },
      });
      return;
    }
    const limit = parsePositiveInteger(request.query.limit, 50, 100);
    if (limit === null) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_INTERACTION_LIMIT",
          message: "Runtime interaction limit must be 1-100.",
        },
      });
      return;
    }

    try {
      const interactions =
        await dependencies.runtimeInteractionService!.listForUser({
          userId: request.webUserId,
          prepareId,
          limit,
        });
      if (interactions === null) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_TURN_NOT_FOUND",
            message: "Native live turn was not found.",
          },
        });
        return;
      }
      response.setHeader("Cache-Control", "private, no-store");
      response.json({
        success: true,
        data: { prepareId, interactions },
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_RUNTIME_INTERACTIONS_UNAVAILABLE",
          message:
            "Native live runtime interactions are temporarily unavailable.",
        },
      });
    }
  };
}

export function resolveNativeLiveRuntimeInteractionHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const prepareId = routeParam(request.params.prepareId);
    const interactionId = routeParam(request.params.interactionId);
    if (
      !UUID_PATTERN.test(prepareId)
      || !UUID_PATTERN.test(interactionId)
    ) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_INTERACTION_ID",
          message: "Native live interaction identity is invalid.",
        },
      });
      return;
    }
    const body = exactBody(request.body, ["response"]);
    if (
      !body
      || !body.response
      || typeof body.response !== "object"
      || Array.isArray(body.response)
    ) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_INTERACTION_RESPONSE",
          message: "Runtime interaction response is invalid.",
        },
      });
      return;
    }

    try {
      const result =
        await dependencies.runtimeInteractionService!.resolve({
          userId: request.webUserId,
          prepareId,
          interactionId,
          response: body.response as Record<string, unknown>,
        });
      response.json({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error instanceof NativeLiveRuntimeInteractionError) {
        const status =
          error.code === "INTERACTION_INVALID"
            ? 400
            : error.code === "INTERACTION_NOT_FOUND"
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
  };
}

export function readNativeLiveRuntimeEventsHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const prepareId = routeParam(request.params.prepareId);
    if (!UUID_PATTERN.test(prepareId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_TURN_ID",
          message: "Native live turn id is invalid.",
        },
      });
      return;
    }

    const afterSequence =
      parseNonnegativeInteger(request.query.after_sequence, 0);
    const limit = parsePositiveInteger(request.query.limit, 100, 200);
    if (afterSequence === null || limit === null) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_RUNTIME_EVENT_CURSOR",
          message:
            "Runtime event cursor must be non-negative and limit must be 1-200.",
        },
      });
      return;
    }

    try {
      const events = await dependencies.runtimeEventService!.list({
        userId: request.webUserId,
        prepareId,
        afterSequence,
        limit,
      });
      if (events === null) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_TURN_NOT_FOUND",
            message: "Native live turn was not found.",
          },
        });
        return;
      }
      response.setHeader("Cache-Control", "private, no-store");
      response.json({
        success: true,
        data: {
          prepareId,
          events,
          nextAfterSequence:
            events.at(-1)?.sequence ?? afterSequence,
        },
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_RUNTIME_EVENTS_UNAVAILABLE",
          message:
            "Native live runtime events are temporarily unavailable.",
        },
      });
    }
  };
}

function parseNonnegativeInteger(
  value: unknown,
  defaultValue: number,
): number | null {
  if (value === undefined) return defaultValue;
  if (
    typeof value !== "string"
    || !/^(?:0|[1-9][0-9]*)$/u.test(value)
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositiveInteger(
  value: unknown,
  defaultValue: number,
  max: number,
): number | null {
  if (value === undefined) return defaultValue;
  if (
    typeof value !== "string"
    || !/^[1-9][0-9]*$/u.test(value)
  ) {
    return null;
  }
  const parsed = Number(value);
  return (
    Number.isSafeInteger(parsed)
    && parsed <= max
  )
    ? parsed
    : null;
}
