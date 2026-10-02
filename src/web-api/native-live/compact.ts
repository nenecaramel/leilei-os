import type {
  RequestHandler,
  Response,
} from "express";
import { NativeLiveManualCompactError } from "../../domains/bridge/turn/native-live-manual-compact.js";
import type { NativeLiveApiDependencies } from "./dependencies.js";
import {
  requireWebUser,
  routeParam,
  UUID_PATTERN,
} from "./http.js";

export function createNativeLiveManualCompactHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const conversationId = routeParam(request.params.conversationId);
    if (!UUID_PATTERN.test(conversationId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_ID",
          message: "Native live conversation id is invalid.",
        },
      });
      return;
    }
    try {
      const compact = await dependencies.manualCompactService!.create({
        userId: request.webUserId!,
        conversationId,
      });
      response.status(202).json({
        success: true,
        data: {
          id: compact.id,
          conversationId: compact.conversationId,
          status: compact.status,
          failureCode: compact.failureCode,
          createdAt: compact.createdAt,
          completedAt: compact.completedAt,
        },
      });
    } catch (error) {
      sendManualCompactApiError(response, error);
    }
  };
}

export function readNativeLiveManualCompactHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const requestId = routeParam(request.params.requestId);
    if (!UUID_PATTERN.test(requestId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_MANUAL_COMPACT_ID",
          message: "Manual compact request id is invalid.",
        },
      });
      return;
    }
    try {
      const compact = await dependencies.manualCompactService!.read({
        userId: request.webUserId!,
        requestId,
      });
      if (!compact) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_MANUAL_COMPACT_NOT_FOUND",
            message: "Manual compact request was not found.",
          },
        });
        return;
      }
      response.json({
        success: true,
        data: {
          id: compact.id,
          conversationId: compact.conversationId,
          status: compact.status,
          failureCode: compact.failureCode,
          createdAt: compact.createdAt,
          completedAt: compact.completedAt,
        },
      });
    } catch (error) {
      sendManualCompactApiError(response, error);
    }
  };
}

function sendManualCompactApiError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveManualCompactError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "RUNTIME_OFFLINE"
          ? 503
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
      code: "NATIVE_LIVE_MANUAL_COMPACT_UNAVAILABLE",
      message: "Manual compact is temporarily unavailable.",
    },
  });
}
