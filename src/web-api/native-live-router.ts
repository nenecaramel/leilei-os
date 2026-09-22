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
};

export function createNativeLiveApiRouter(
  dependencies: NativeLiveApiDependencies,
): Router {
  const router = Router();
  router.post("/prepare", prepareNativeLiveTurnHandler(dependencies));
  router.get("/turns/:prepareId", readNativeLiveTurnHandler(dependencies));
  return router;
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
        ? 404
        : result.code === "STALE_HEAD"
          || result.code === "REQUEST_CONFLICT"
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
        data: {
          prepareId: turn.prepareId,
          requestId: turn.requestId,
          conversationId: turn.conversationId,
          operation: turn.operation,
          userMessageId: turn.canonicalUserMessageId,
          canonicalStatus: turn.canonicalStatus,
          dispatchStatus: turn.dispatchStatus,
          semanticStatus: turn.semanticStatus,
          semanticFallbackCode: turn.semanticFallbackCode,
          failureCode: turn.failureCode,
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
        },
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
