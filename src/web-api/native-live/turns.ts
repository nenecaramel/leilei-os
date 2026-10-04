import type {
  RequestHandler,
  Response,
} from "express";
import type { NativeLiveRelayPrepareResult } from "../../domains/bridge/relay/native-live-backend-relay-prepare.js";
import type { NativeLiveBackendTurnReadModel } from "../../domains/bridge/turn/native-live-backend-turn-repository.js";
import type { NativeLiveApiDependencies } from "./dependencies.js";
import {
  requireWebUser,
  routeParam,
  UUID_PATTERN,
} from "./http.js";

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

    const preparedTurn = await dependencies.turnReader.readTurn({ userId:request.webUserId!, prepareId:result.command.prepare_id }).catch(() => null);
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
          ...(preparedTurn?.startedAt ? { startedAt:preparedTurn.startedAt } : {}),
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

export function readNativeLiveActiveTurnHandler(
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

    const readActiveTurn = dependencies.turnReader.readActiveTurn;
    if (!readActiveTurn) {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_ACTIVE_TURN_READ_UNAVAILABLE",
          message: "Active native live turn lookup is unavailable.",
        },
      });
      return;
    }

    try {
      const turn = await readActiveTurn.call(dependencies.turnReader, {
        userId: request.webUserId,
        conversationId,
      });
      response.setHeader("Cache-Control", "private, no-store");
      response.json({
        success: true,
        data: {
          turn: turn ? nativeLiveTurnResponseData(turn) : null,
        },
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_ACTIVE_TURN_READ_UNAVAILABLE",
          message: "Active native live turn is temporarily unavailable.",
        },
      });
    }
  };
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
    ...(turn.startedAt ? { startedAt:turn.startedAt } : {}),
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
