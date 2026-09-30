import { Router, type RequestHandler, type Response } from "express";
import type {
  NativeLiveRelayPrepareResult,
} from "../domains/bridge/native-live-backend-relay-prepare.js";
import type {
  NativeLiveBackendTurnReadModel,
} from "../domains/bridge/native-live-backend-turn-repository.js";
import type {
  NativeLiveBackendRelayService,
} from "../domains/bridge/native-live-backend-relay.js";
import {
  DEFAULT_NATIVE_LIVE_CURRENT_PATH_LIMIT,
  MAX_NATIVE_LIVE_CURRENT_PATH_LIMIT,
  nativeLiveCurrentPathEtag,
  type NativeLiveCurrentPathReader,
} from "../domains/conversation/native-live-current-path-read-repository.js";
import type {
  NativeLiveConversationService,
} from "../domains/conversation/native-live-conversation-service.js";
import type {
  NativeLiveConversationRuntimeMetadataReader,
} from "../domains/conversation/native-live-conversation-runtime-metadata.js";
import type {
  NativeLiveRuntimeEventService,
} from "../domains/bridge/native-live-runtime-event-stream.js";
import {
  NativeLiveRuntimeInteractionError,
  type NativeLiveRuntimeInteractionService,
} from "../domains/bridge/native-live-runtime-interaction.js";
import {
  NativeLiveRuntimeControlError,
  type NativeLiveRuntimeControlService,
} from "../domains/bridge/native-live-runtime-control.js";
import type {
  NativeLiveTurnWaitService,
} from "../domains/bridge/native-live-turn-wait.js";
import {
  NativeLiveManualCompactError,
  type NativeLiveManualCompactService,
} from "../domains/bridge/native-live-manual-compact.js";
import {
  NativeLiveExternalSessionBridgeError,
  type NativeLiveConversationHistoryUpload,
  type NativeLiveExternalSessionBridgeService,
} from "../domains/bridge/native-live-external-session-bridge.js";
import {
  NativeLiveAttachmentError,
  type NativeLiveAttachmentService,
} from "../domains/bridge/native-live-attachment-service.js";

export type NativeLiveApiDependencies = {
  coordinator: {
    prepare(
      userId: string,
      rawRequest: unknown,
    ): Promise<NativeLiveRelayPrepareResult>;
  };
  relayService: Pick<NativeLiveBackendRelayService, "enqueuePreparation">;
  turnReader: {
    readTurn(input: {
      userId: string;
      prepareId: string;
    }): Promise<NativeLiveBackendTurnReadModel | null>;
  };
  turnWaitService?: Pick<NativeLiveTurnWaitService, "wait">;
  currentPathReader?: NativeLiveCurrentPathReader;
  conversationRuntimeMetadataReader?:
    NativeLiveConversationRuntimeMetadataReader;
  conversationService?: Pick<
    NativeLiveConversationService,
    "listConversations" | "listConversationPage" | "createConversation" | "renameConversation" | "archiveConversation" | "restoreConversation" | "deleteConversation"
  >;
  runtimeEventService?: Pick<
    NativeLiveRuntimeEventService,
    "list"
  >;
  runtimeInteractionService?: Pick<
    NativeLiveRuntimeInteractionService,
    "listForUser" | "resolve"
  >;
  runtimeControlService?: Pick<
    NativeLiveRuntimeControlService,
    "createForUser" | "listForUser"
  >;
  manualCompactService?: Pick<
    NativeLiveManualCompactService,
    "create" | "read"
  >;
  externalSessionBridgeService?: Pick<
    NativeLiveExternalSessionBridgeService,
    "createListRequest" | "readListRequest" | "createConversationFromSession" | "readConversationHistorySnapshot"
  >;
  attachmentService?: NativeLiveAttachmentService;
};

export function createNativeLiveApiRouter(
  dependencies: NativeLiveApiDependencies,
): Router {
  const router = Router();
  router.post("/prepare", prepareNativeLiveTurnHandler(dependencies));
  if (dependencies.attachmentService) {
    router.post(
      "/attachments/upload-slots",
      createNativeLiveAttachmentUploadSlotHandler(dependencies),
    );
    router.post(
      "/attachments/:attachmentId/complete",
      completeNativeLiveAttachmentHandler(dependencies),
    );
    router.post(
      "/attachments/:attachmentId/download-slot",
      createNativeLiveAttachmentDownloadSlotHandler(dependencies),
    );
  }
  router.get("/turns/:prepareId", readNativeLiveTurnHandler(dependencies));
  if (dependencies.turnWaitService) {
    router.post(
      "/turns/:prepareId/wait",
      waitNativeLiveTurnHandler(dependencies),
    );
  }
  if (dependencies.runtimeEventService) {
    router.get(
      "/turns/:prepareId/events",
      readNativeLiveRuntimeEventsHandler(dependencies),
    );
  }
  if (dependencies.runtimeInteractionService) {
    router.get(
      "/turns/:prepareId/interactions",
      readNativeLiveRuntimeInteractionsHandler(dependencies),
    );
    router.post(
      "/turns/:prepareId/interactions/:interactionId/respond",
      resolveNativeLiveRuntimeInteractionHandler(dependencies),
    );
  }
  if (dependencies.runtimeControlService) {
    router.get(
      "/turns/:prepareId/controls",
      readNativeLiveRuntimeControlsHandler(dependencies),
    );
    router.post(
      "/turns/:prepareId/controls",
      createNativeLiveRuntimeControlHandler(dependencies),
    );
  }
  if (dependencies.conversationService) {
    router.get(
      "/conversations",
      listNativeLiveConversationsHandler(dependencies),
    );
    router.post(
      "/conversations",
      createNativeLiveConversationHandler(dependencies),
    );
    router.patch(
      "/conversations/:conversationId",
      renameNativeLiveConversationHandler(dependencies),
    );
    router.post(
      "/conversations/:conversationId/archive",
      archiveNativeLiveConversationHandler(dependencies),
    );
    router.post(
      "/conversations/:conversationId/restore",
      restoreNativeLiveConversationHandler(dependencies),
    );
    router.delete(
      "/conversations/:conversationId",
      deleteNativeLiveConversationHandler(dependencies),
    );
  }
  if (dependencies.currentPathReader) {
    router.get(
      "/conversations/:conversationId/current-path",
      readNativeLiveCurrentPathHandler(dependencies),
    );
  }
  if (dependencies.conversationRuntimeMetadataReader) {
    router.get(
      "/conversations/:conversationId/runtime-metadata",
      readNativeLiveConversationRuntimeMetadataHandler(dependencies),
    );
  }
  if (dependencies.manualCompactService) {
    router.post(
      "/conversations/:conversationId/compact",
      createNativeLiveManualCompactHandler(dependencies),
    );
    router.get(
      "/manual-compacts/:requestId",
      readNativeLiveManualCompactHandler(dependencies),
    );
  }
  if (dependencies.externalSessionBridgeService) {
    router.post(
      "/external-sessions/requests",
      createNativeLiveExternalSessionListHandler(dependencies),
    );
    router.get(
      "/external-sessions/requests/:requestId",
      readNativeLiveExternalSessionListHandler(dependencies),
    );
    router.post(
      "/conversations/from-claude-session",
      createNativeLiveConversationFromClaudeSessionHandler(dependencies),
    );
    router.get(
      "/conversations/:conversationId/history-snapshot",
      readNativeLiveConversationHistorySnapshotHandler(dependencies),
    );
  }
  return router;
}

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

export function listNativeLiveConversationsHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;

    const limit = parseConversationListLimit(request.query.limit);
    if (limit === null) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_LIST_LIMIT",
          message:
            `Conversation list limit must be an integer from 1 to ${MAX_NATIVE_LIVE_CONVERSATION_LIST_LIMIT}.`,
        },
      });
      return;
    }

    const scope = parseConversationListScope(request.query.scope);
    if (scope === null) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_LIST_SCOPE",
          message: "Conversation list scope must be active or archived.",
        },
      });
      return;
    }

    const cursor = parseOptionalCursorQuery(request.query.cursor);
    if (cursor === null) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_LIST_CURSOR",
          message: "Conversation list cursor must be a single non-empty string.",
        },
      });
      return;
    }

    const service = dependencies.conversationService;
    if (!service) {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_BOOTSTRAP_UNAVAILABLE",
          message: "Native live conversation bootstrap is temporarily unavailable.",
        },
      });
      return;
    }

    try {
      const page = await service.listConversationPage({
        userId: request.webUserId,
        limit,
        ...(scope ? { scope } : {}),
        ...(cursor ? { cursor } : {}),
      });
      response.json({
        success: true,
        data: {
          conversations: page.conversations,
          nextCursor: page.nextCursor,
        },
      });
    } catch (error) {
      if (error instanceof RangeError) {
        response.status(400).json({
          success: false,
          error: {
            code: "INVALID_NATIVE_LIVE_CONVERSATION_LIST_CURSOR",
            message: error.message,
          },
        });
        return;
      }
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_BOOTSTRAP_UNAVAILABLE",
          message: "Native live conversations are temporarily unavailable.",
        },
      });
    }
  };
}

export function createNativeLiveConversationHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;

    const parsed = parseCreateConversationBody(request.body);
    if (!parsed.ok) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_CREATE",
          message:
            "Conversation title must be null or a non-empty string up to 200 characters.",
        },
      });
      return;
    }

    const service = dependencies.conversationService;
    if (!service) {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_BOOTSTRAP_UNAVAILABLE",
          message: "Native live conversation bootstrap is temporarily unavailable.",
        },
      });
      return;
    }

    try {
      const conversation = await service.createConversation({
        userId: request.webUserId,
        title: parsed.title,
      });
      response.status(201).json({
        success: true,
        data: {
          id: conversation.id,
          title: conversation.title,
          currentHeadMessageId: conversation.currentHeadMessageId,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_BOOTSTRAP_UNAVAILABLE",
          message: "Native live conversation could not be created.",
        },
      });
    }
  };
}

export function renameNativeLiveConversationHandler(
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

    const body = exactBody(request.body, ["title"]);
    const title = body?.title;
    if (typeof title !== "string") {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_RENAME",
          message:
            "Conversation title must be a non-empty string up to 200 characters.",
        },
      });
      return;
    }

    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0 || trimmedTitle.length > 200) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_RENAME",
          message:
            "Conversation title must be a non-empty string up to 200 characters.",
        },
      });
      return;
    }

    const service = dependencies.conversationService;
    if (!service) {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_LIFECYCLE_UNAVAILABLE",
          message:
            "Native live conversation lifecycle is temporarily unavailable.",
        },
      });
      return;
    }

    try {
      const renamed = await service.renameConversation({
        userId: request.webUserId,
        conversationId,
        title: trimmedTitle,
      });

      if (!renamed) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
            message: "Native live conversation was not found.",
          },
        });
        return;
      }

      response.json({
        success: true,
        data: renamed,
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_LIFECYCLE_UNAVAILABLE",
          message:
            "Native live conversation could not be renamed.",
        },
      });
    }
  };
}

export function archiveNativeLiveConversationHandler(
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
      const result = await dependencies.conversationService!.archiveConversation({
        userId: request.webUserId,
        conversationId,
      });
      if (result.outcome === "busy") {
        response.status(409).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_BUSY",
            message:
              "Native live conversation has an active turn and cannot be archived yet.",
          },
        });
        return;
      }
      if (result.outcome === "not_found") {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
            message: "Native live conversation was not found.",
          },
        });
        return;
      }
      response.status(204).end();
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_LIFECYCLE_UNAVAILABLE",
          message: "Native live conversation could not be archived.",
        },
      });
    }
  };
}

export function restoreNativeLiveConversationHandler(
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
      const result = await dependencies.conversationService!.restoreConversation({
        userId: request.webUserId,
        conversationId,
      });
      if (result.outcome === "not_found") {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
            message: "Archived native live conversation was not found.",
          },
        });
        return;
      }
      response.status(204).end();
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_LIFECYCLE_UNAVAILABLE",
          message: "Native live conversation could not be restored.",
        },
      });
    }
  };
}

export function deleteNativeLiveConversationHandler(
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
    if (request.query.confirm !== "true") {
      response.status(400).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_DELETE_CONFIRMATION_REQUIRED",
          message: "True conversation deletion requires confirm=true.",
        },
      });
      return;
    }
    try {
      const result = await dependencies.conversationService!.deleteConversation({
        userId: request.webUserId,
        conversationId,
      });
      if (result.outcome === "busy") {
        response.status(409).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_BUSY",
            message:
              "Native live conversation has an active turn and cannot be deleted yet.",
          },
        });
        return;
      }
      if (result.outcome === "not_found") {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
            message: "Native live conversation was not found.",
          },
        });
        return;
      }
      response.status(204).end();
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_LIFECYCLE_UNAVAILABLE",
          message: "Native live conversation could not be deleted.",
        },
      });
    }
  };
}

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

export function prepareNativeLiveTurnHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;

    const result = await dependencies.coordinator.prepare(
      request.webUserId,
      request.body,
    );

    if (!result.ok) {
      sendPrepareFailure(response, result);
      return;
    }

    if (!result.semanticPending) {
      try {
        await dependencies.relayService.enqueuePreparation({
          userId: request.webUserId,
          prepareId: result.command.prepare_id,
        });
      } catch {
        response.status(503).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_RELAY_UNAVAILABLE",
            message: "Native live turn was prepared but could not be queued.",
          },
        });
        return;
      }
    }

    response
      .status(
        result.semanticPending
          ? 202
          : result.outcome === "created"
            ? 201
            : 200,
      )
      .json({
        success: true,
        data: {
          outcome: result.outcome,
          semanticPending: result.semanticPending,
          prepareId: result.command.prepare_id,
          requestId: result.command.request_id,
          conversationId: result.command.conversation_id,
          userMessageId: result.command.canonical_user_message_id,
          workspaceId: result.command.workspace_id ?? null,
          expectedWorkspaceRoot:
            result.command.expected_workspace_root ?? null,
        },
      });
  };
}

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

function sendPrepareFailure(
  response: Response,
  result: Extract<NativeLiveRelayPrepareResult, { ok: false }>,
): void {
  const status =
    result.code === "INVALID_REQUEST"
      ? 400
      : result.code === "CONVERSATION_NOT_FOUND"
        || result.code === "BRANCH_POINT_INVALID"
        || result.code === "CHECKPOINT_NOT_FOUND"
        || result.code === "WORKSPACE_NOT_FOUND"
        ? 404
        : result.code === "STALE_HEAD"
          || result.code === "REQUEST_CONFLICT"
          || result.code === "WORKSPACE_BINDING_AMBIGUOUS"
          || result.code === "WORKSPACE_BINDING_CONFLICT"
          ? 409
          : 503;

  response.status(status).json({
    success: false,
    error: {
      code: result.code,
      message:
        result.code === "STALE_HEAD"
          ? "Conversation head changed before the turn was prepared."
          : result.code === "REQUEST_CONFLICT"
            ? "Request id conflicts with an existing prepared turn."
            : result.code === "WORKSPACE_NOT_FOUND"
              ? "Workspace was not found."
              : result.code === "WORKSPACE_BINDING_AMBIGUOUS"
                ? "Conversation has multiple Workspace references; select one explicitly."
                : result.code === "WORKSPACE_BINDING_CONFLICT"
                  ? "The current provider branch is already bound to another Workspace."
                  : result.code === "INVALID_REQUEST"
                    ? "Native live turn request is invalid."
                    : result.code === "INTERNAL_ERROR"
                      ? "Native live turn preparation is temporarily unavailable."
                      : "Native live turn could not be prepared.",
      ...(result.currentHeadMessageId !== undefined
        ? { currentHeadMessageId: result.currentHeadMessageId }
        : {}),
    },
  });
}

function requireWebUser(
  response: Response,
  userId: string | undefined,
): userId is string {
  if (userId) return true;
  response.status(401).json({
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "Web API authentication is required.",
    },
  });
  return false;
}


export function readNativeLiveTurnHandler(
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

    try {
      const turn = await dependencies.turnReader.readTurn({
        userId: request.webUserId,
        prepareId,
      });
      if (!turn) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_TURN_NOT_FOUND",
            message: "Native live turn was not found.",
          },
        });
        return;
      }

      response.json({
        success: true,
        data: nativeLiveTurnResponseData(turn),
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_TURN_READ_UNAVAILABLE",
          message: "Native live turn is temporarily unavailable.",
        },
      });
    }
  };
}

export function waitNativeLiveTurnHandler(
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

    const service = dependencies.turnWaitService;
    if (!service) {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_TURN_WAIT_UNAVAILABLE",
          message:
            "Native live turn completion wait is temporarily unavailable.",
        },
      });
      return;
    }

    const controller = new AbortController();
    const onClose = () => controller.abort();
    response.once("close", onClose);
    try {
      const result = await service.wait({
        userId: request.webUserId,
        prepareId,
        timeoutMs: 25_000,
        signal: controller.signal,
      });
      if (response.writableEnded || controller.signal.aborted) return;

      if (!result) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_TURN_NOT_FOUND",
            message: "Native live turn was not found.",
          },
        });
        return;
      }

      response.json({
        success: true,
        data:
          result.outcome === "terminal"
            ? {
                outcome: "terminal",
                turn: nativeLiveTurnResponseData(result.turn),
              }
            : { outcome: "timeout" },
      });
    } catch {
      if (response.writableEnded || controller.signal.aborted) return;
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_TURN_WAIT_UNAVAILABLE",
          message:
            "Native live turn completion wait is temporarily unavailable.",
        },
      });
    } finally {
      response.off("close", onClose);
    }
  };
}

function nativeLiveTurnResponseData(
  turn: NativeLiveBackendTurnReadModel,
): Record<string, unknown> {
  return {
    prepareId: turn.prepareId,
    requestId: turn.requestId,
    conversationId: turn.conversationId,
    operation: turn.operation,
    userMessageId: turn.canonicalUserMessageId,
    workspaceId: turn.workspaceId,
    expectedWorkspaceRoot: turn.expectedWorkspaceRoot,
    executionSelection: turn.executionSelection,
    canonicalStatus: turn.canonicalStatus,
    dispatchStatus: turn.dispatchStatus,
    semanticStatus: turn.semanticStatus,
    semanticFallbackCode: turn.semanticFallbackCode,
    failureCode: turn.failureCode,
    runtimeMetadata: turn.runtimeMetadata,
    assistantMessage: turn.assistantMessage
      ? {
          id: turn.assistantMessage.id,
          parentMessageId: turn.assistantMessage.parentMessageId,
          status: turn.assistantMessage.status,
          createdAt: turn.assistantMessage.createdAt,
          completedAt: turn.assistantMessage.completedAt,
          blocks: turn.assistantMessage.blocks,
        }
      : null,
  };
}

export function readNativeLiveConversationRuntimeMetadataHandler(
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
          message: "Conversation id must be a UUID.",
        },
      });
      return;
    }

    const reader = dependencies.conversationRuntimeMetadataReader;
    if (!reader) {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_RUNTIME_METADATA_UNAVAILABLE",
          message:
            "Native live conversation runtime metadata is temporarily unavailable.",
        },
      });
      return;
    }

    try {
      const snapshot = await reader.readLatest({
        userId: request.webUserId,
        conversationId,
      });
      if (!snapshot) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
            message: "Native live conversation was not found.",
          },
        });
        return;
      }
      response.json({
        success: true,
        data: snapshot,
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_RUNTIME_METADATA_UNAVAILABLE",
          message:
            "Native live conversation runtime metadata is temporarily unavailable.",
        },
      });
    }
  };
}

export function readNativeLiveCurrentPathHandler(
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

    const limit = parseCurrentPathLimit(request.query.limit);
    if (limit === null) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CURRENT_PATH_LIMIT",
          message:
            `Current path limit must be an integer from 1 to ${MAX_NATIVE_LIVE_CURRENT_PATH_LIMIT}.`,
        },
      });
      return;
    }

    const beforeMessageId =
      parseOptionalUuidQuery(request.query.before_message_id);
    const afterMessageId =
      parseOptionalUuidQuery(request.query.after_message_id);
    if (
      beforeMessageId === null
      || afterMessageId === null
      || (beforeMessageId && afterMessageId)
    ) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CURRENT_PATH_CURSOR",
          message:
            "Current path accepts one valid before_message_id or after_message_id cursor.",
        },
      });
      return;
    }

    const reader = dependencies.currentPathReader;
    if (!reader) {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CURRENT_PATH_UNAVAILABLE",
          message:
            "Native live current path is temporarily unavailable.",
        },
      });
      return;
    }

    try {
      const snapshot = await reader.readCurrentPath({
        userId: request.webUserId,
        conversationId,
        limit,
        ...(beforeMessageId ? { beforeMessageId } : {}),
        ...(afterMessageId ? { afterMessageId } : {}),
      });
      if (!snapshot) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
            message: "Native live conversation was not found.",
          },
        });
        return;
      }

      const etag = nativeLiveCurrentPathEtag(
        snapshot.syncToken,
        limit,
        { beforeMessageId, afterMessageId },
      );
      response.setHeader("ETag", etag);
      if (ifNoneMatchContains(request.header("if-none-match"), etag)) {
        response.status(304).end();
        return;
      }

      response.json({
        success: true,
        data: {
          conversationId: snapshot.conversationId,
          title: snapshot.title,
          currentHeadMessageId:
            snapshot.currentHeadMessageId,
          updatedAt: snapshot.updatedAt,
          syncToken: snapshot.syncToken,
          truncated: snapshot.truncated,
          olderCursor: snapshot.olderCursor,
          resetRequired: snapshot.resetRequired,
          messages: snapshot.messages,
        },
      });
    } catch (error) {
      if (error instanceof RangeError) {
        response.status(400).json({
          success: false,
          error: {
            code: "INVALID_NATIVE_LIVE_CURRENT_PATH_CURSOR",
            message: error.message,
          },
        });
        return;
      }
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CURRENT_PATH_UNAVAILABLE",
          message:
            "Native live current path is temporarily unavailable.",
        },
      });
    }
  };
}

function sendNativeLiveAttachmentApiError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveAttachmentError) {
    const status =
      error.code === "INVALID_ATTACHMENT"
      || error.code === "ATTACHMENT_LIMIT_EXCEEDED"
        ? 400
        : error.code === "ATTACHMENT_NOT_FOUND"
          ? 404
          : error.code === "ATTACHMENT_STORAGE_UNAVAILABLE"
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
      code: "NATIVE_LIVE_ATTACHMENT_UNAVAILABLE",
      message: "Native Live attachment service is temporarily unavailable.",
    },
  });
}

const DEFAULT_NATIVE_LIVE_CONVERSATION_LIST_LIMIT = 50;
const MAX_NATIVE_LIVE_CONVERSATION_LIST_LIMIT = 100;

function exactBody(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  return (
    actual.length === keys.length
    && actual.every((key) => keys.includes(key))
  )
    ? record
    : null;
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

function parseConversationListLimit(
  value: unknown,
): number | null {
  if (value === undefined) {
    return DEFAULT_NATIVE_LIVE_CONVERSATION_LIST_LIMIT;
  }
  if (
    typeof value !== "string"
    || !/^[1-9][0-9]{0,2}$/u.test(value)
  ) {
    return null;
  }
  const parsed = Number(value);
  return (
    Number.isInteger(parsed)
    && parsed >= 1
    && parsed <= MAX_NATIVE_LIVE_CONVERSATION_LIST_LIMIT
  )
    ? parsed
    : null;
}

function parseCreateConversationBody(
  value: unknown,
): { ok: true; title: string | null } | { ok: false } {
  if (value === undefined) return { ok: true, title: null };
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    return { ok: false };
  }

  const title = (value as Record<string, unknown>).title;
  if (title === undefined || title === null) {
    return { ok: true, title: null };
  }
  if (typeof title !== "string") return { ok: false };

  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return { ok: false };
  }
  return { ok: true, title: trimmed };
}

function parseConversationListScope(
  value: unknown,
): "active" | "archived" | undefined | null {
  if (value === undefined) return undefined;
  return value === "active" || value === "archived"
    ? value
    : null;
}

function parseOptionalCursorQuery(
  value: unknown,
): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) return null;
  return value;
}

function parseOptionalUuidQuery(
  value: unknown,
): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return null;
  }
  return value;
}

function parseCurrentPathLimit(
  value: unknown,
): number | null {
  if (value === undefined) {
    return DEFAULT_NATIVE_LIVE_CURRENT_PATH_LIMIT;
  }
  if (
    typeof value !== "string"
    || !/^[1-9][0-9]{0,2}$/u.test(value)
  ) {
    return null;
  }
  const parsed = Number(value);
  return (
    Number.isInteger(parsed)
    && parsed >= 1
    && parsed <= MAX_NATIVE_LIVE_CURRENT_PATH_LIMIT
  )
    ? parsed
    : null;
}

function ifNoneMatchContains(
  value: string | undefined,
  etag: string,
): boolean {
  if (!value) return false;
  return value
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) =>
      candidate === "*"
      || candidate === etag
      || candidate === `W/${etag}`
    );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
