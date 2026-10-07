import type {
  RequestHandler,
  Response,
} from "express";
import {
  NativeLiveClaudeHandoffError,
} from "../../domains/bridge/provider-session/native-live-claude-handoff.js";
import type { NativeLiveApiDependencies } from "./dependencies.js";
import {
  requireWebUser,
  routeParam,
} from "./http.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createNativeLiveClaudeHandoffHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const conversationId =
      routeParam(request.params.conversationId);
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
      const handoff =
        await dependencies.claudeHandoffService!.create({
          userId: request.webUserId!,
          conversationId,
        });
      response.status(202).json({
        success: true,
        data: handoff,
      });
    } catch (error) {
      sendClaudeHandoffApiError(response, error);
    }
  };
}

export function readNativeLiveClaudeHandoffHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const requestId = routeParam(request.params.requestId);
    if (!UUID_PATTERN.test(requestId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CLAUDE_HANDOFF_ID",
          message: "Claude handoff request id is invalid.",
        },
      });
      return;
    }
    try {
      const handoff =
        await dependencies.claudeHandoffService!.read({
          userId: request.webUserId!,
          requestId,
        });
      if (!handoff) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CLAUDE_HANDOFF_NOT_FOUND",
            message: "Claude handoff request was not found.",
          },
        });
        return;
      }
      response.json({
        success: true,
        data: handoff,
      });
    } catch (error) {
      sendClaudeHandoffApiError(response, error);
    }
  };
}

function sendClaudeHandoffApiError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveClaudeHandoffError) {
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
      code: "NATIVE_LIVE_CLAUDE_HANDOFF_UNAVAILABLE",
      message: "Claude Code handoff is temporarily unavailable.",
    },
  });
}
