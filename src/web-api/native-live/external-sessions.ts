import type {
  RequestHandler,
  Response,
} from "express";
import {
  NativeLiveExternalSessionBridgeError,
} from "../../domains/bridge/provider-session/native-live-external-session-bridge.js";
import type { NativeLiveApiDependencies } from "./dependencies.js";
import {
  requireWebUser,
  routeParam,
  UUID_PATTERN,
} from "./http.js";

export function createNativeLiveExternalSessionListHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    try {
      const result =
        await dependencies.externalSessionBridgeService!.createListRequest({
          userId: request.webUserId!,
        });
      response.status(202).json({
        success: true,
        data: externalSessionRequestPayload(result),
      });
    } catch (error) {
      sendExternalSessionBridgeError(response, error);
    }
  };
}

export function readNativeLiveExternalSessionListHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const requestId = routeParam(request.params.requestId);
    if (!UUID_PATTERN.test(requestId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_EXTERNAL_SESSION_REQUEST_ID",
          message: "External session request id is invalid.",
        },
      });
      return;
    }
    try {
      const result =
        await dependencies.externalSessionBridgeService!.readListRequest({
          userId: request.webUserId!,
          requestId,
        });
      if (!result) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_EXTERNAL_SESSION_REQUEST_NOT_FOUND",
            message: "External session request was not found.",
          },
        });
        return;
      }
      response.json({
        success: true,
        data: externalSessionRequestPayload(result),
      });
    } catch (error) {
      sendExternalSessionBridgeError(response, error);
    }
  };
}

export function createNativeLiveConversationFromClaudeSessionHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const body =
      request.body
      && typeof request.body === "object"
      && !Array.isArray(request.body)
        ? request.body as Record<string, unknown>
        : null;
    const bodyKeys = body ? Object.keys(body) : [];
    const validKeys =
      body
      && bodyKeys.includes("request_id")
      && bodyKeys.includes("source_session_id")
      && bodyKeys.every((key) =>
        key === "request_id"
        || key === "source_session_id"
        || key === "title"
        || key === "history_snapshot"
      );
    const requestId = validKeys ? body.request_id : undefined;
    const sourceSessionId =
      validKeys ? body.source_session_id : undefined;
    const title = validKeys ? body.title : undefined;
    const requestedHistorySnapshot = Boolean(bodyKeys.includes("history_snapshot"));
    if (
      typeof requestId !== "string"
      || !UUID_PATTERN.test(requestId)
      || typeof sourceSessionId !== "string"
      || !sourceSessionId.trim()
      || !(
        title === undefined
        || title === null
        || (
          typeof title === "string"
          && title.trim().length > 0
          && [...title.trim()].length <= 200
        )
      )
    ) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_EXTERNAL_SESSION_CREATE",
          message:
            "External session create request is invalid.",
        },
      });
      return;
    }

    if (requestedHistorySnapshot) {
      response.status(410).json({ success: false, error: {
        code: "HISTORY_SNAPSHOT_RETIRED",
        message: "Historical display snapshots are no longer imported.",
      } });
      return;
    }
    try {
      const conversation =
        await dependencies.externalSessionBridgeService!
          .createConversationFromSession({
            userId: request.webUserId!,
            requestId,
            sourceSessionId: sourceSessionId.trim(),
            ...(typeof title === "string"
              ? { title: title.trim() }
              : {}),
          });
      response.status(201).json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      sendExternalSessionBridgeError(response, error);
    }
  };
}

export function readNativeLiveConversationHistorySnapshotHandler(
  _dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    if (typeof request.params.conversationId !== "string"
      || !UUID_PATTERN.test(request.params.conversationId)) {
      response.status(400).json({ success: false, error: {
        code: "INVALID_NATIVE_LIVE_CONVERSATION_ID", message: "Conversation id is invalid.",
      } });
      return;
    }
    response.status(410).json({ success: false, error: {
      code: "HISTORY_SNAPSHOT_RETIRED",
      message: "Old Desktop display history is no longer served by LeileiOS.",
    } });
  };
}

function externalSessionRequestPayload(input: {
  id: string;
  status: string;
  failureCode: string | null;
  sessions: Array<{
    sessionId: string;
    summary: string | null;
    customTitle: string | null;
    firstPrompt: string | null;
    gitBranch: string | null;
    lastModified: number | null;
    createdAt: number | null;
    workingDirectory: string;
  }>;
  createdAt: string;
  completedAt: string | null;
}) {
  return {
    id: input.id,
    status: input.status,
    failureCode: input.failureCode,
    sessions: input.sessions,
    createdAt: input.createdAt,
    completedAt: input.completedAt,
  };
}

function sendExternalSessionBridgeError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveExternalSessionBridgeError) {
    const status =
      error.code === "REQUEST_NOT_FOUND"
        || error.code === "SESSION_NOT_FOUND"
        ? 404
        : error.code === "INVALID_HISTORY_SNAPSHOT"
          ? 400
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
      code: "NATIVE_LIVE_EXTERNAL_SESSION_UNAVAILABLE",
      message: "External Claude sessions are temporarily unavailable.",
    },
  });
}
