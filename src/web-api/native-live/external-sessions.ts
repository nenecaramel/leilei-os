import type {
  RequestHandler,
  Response,
} from "express";
import {
  NativeLiveExternalSessionBridgeError,
  type NativeLiveConversationHistoryUpload,
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
    const rawHistorySnapshot =
      validKeys ? body.history_snapshot : undefined;
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

    let historySnapshot: NativeLiveConversationHistoryUpload | null = null;
    try {
      historySnapshot = parseExternalHistorySnapshotInput(
        rawHistorySnapshot,
      );
    } catch {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_HISTORY_SNAPSHOT",
          message: "Conversation history snapshot is invalid.",
        },
      });
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
            ...(historySnapshot
              ? { historySnapshot }
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
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const conversationId = request.params.conversationId;
    if (
      typeof conversationId !== "string"
      || !UUID_PATTERN.test(conversationId)
    ) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_ID",
          message: "Conversation id is invalid.",
        },
      });
      return;
    }

    try {
      const snapshot =
        await dependencies.externalSessionBridgeService!
          .readConversationHistorySnapshot({
            userId: request.webUserId!,
            conversationId,
          });
      if (!snapshot) {
        response.status(404).json({
          success: false,
          error: {
            code: "HISTORY_SNAPSHOT_NOT_FOUND",
            message: "Conversation history snapshot was not found.",
          },
        });
        return;
      }
      response.json({
        success: true,
        data: snapshot,
      });
    } catch (error) {
      sendExternalSessionBridgeError(response, error);
    }
  };
}

function parseExternalHistorySnapshotInput(
  value: unknown,
): NativeLiveConversationHistoryUpload | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid history snapshot");
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (
    !keys.includes("messages")
    || !keys.every((key) =>
      key === "source_label"
      || key === "time_zone"
      || key === "messages"
    )
  ) {
    throw new Error("invalid history snapshot");
  }
  const sourceLabel = row.source_label;
  const timeZone = row.time_zone;
  if (
    !(
      sourceLabel === undefined
      || sourceLabel === null
      || (
        typeof sourceLabel === "string"
        && sourceLabel.trim().length > 0
        && [...sourceLabel.trim()].length <= 255
      )
    )
    || !(
      timeZone === undefined
      || timeZone === null
      || (
        typeof timeZone === "string"
        && timeZone.trim().length > 0
        && [...timeZone.trim()].length <= 64
      )
    )
    || !Array.isArray(row.messages)
    || row.messages.length < 1
    || row.messages.length > 5_000
  ) {
    throw new Error("invalid history snapshot");
  }

  let totalChars = 0;
  const messages = row.messages.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid history snapshot message");
    }
    const message = value as Record<string, unknown>;
    const messageKeys = Object.keys(message);
    if (
      messageKeys.length !== 3
      || !messageKeys.includes("role")
      || !messageKeys.includes("time")
      || !messageKeys.includes("content")
      || (message.role !== "user" && message.role !== "assistant")
      || typeof message.time !== "string"
      || !message.time.trim()
      || Number.isNaN(Date.parse(message.time))
      || typeof message.content !== "string"
      || !message.content.trim()
      || [...message.content].length > 100_000
    ) {
      throw new Error("invalid history snapshot message");
    }
    totalChars += [...message.content].length;
    if (totalChars > 700_000) {
      throw new Error("history snapshot too large");
    }
    return {
      role: message.role as "user" | "assistant",
      time: message.time.trim(),
      content: message.content,
    };
  });

  return {
    ...(typeof sourceLabel === "string"
      ? { sourceLabel: sourceLabel.trim() }
      : {}),
    ...(typeof timeZone === "string"
      ? { timeZone: timeZone.trim() }
      : {}),
    messages,
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
    workspaceId: string | null;
    workspaceRoot: string;
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
