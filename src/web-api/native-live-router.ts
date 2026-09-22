import { Router, type RequestHandler, type Response } from "express";
import type {
  NativeLiveBackendTurnCoordinator,
  NativeLivePrepareResult,
} from "../domains/bridge/native-live-backend-turn-coordinator.js";
import type {
  NativeLiveBackendRelayService,
} from "../domains/bridge/native-live-backend-relay.js";

export type NativeLiveApiDependencies = {
  coordinator: Pick<NativeLiveBackendTurnCoordinator, "prepare">;
  relayService: Pick<NativeLiveBackendRelayService, "enqueuePreparation">;
};

export function createNativeLiveApiRouter(
  dependencies: NativeLiveApiDependencies,
): Router {
  const router = Router();
  router.post("/prepare", prepareNativeLiveTurnHandler(dependencies));
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

    response.status(result.outcome === "created" ? 201 : 200).json({
      success: true,
      data: {
        outcome: result.outcome,
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
  result: Extract<NativeLivePrepareResult, { ok: false }>,
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
