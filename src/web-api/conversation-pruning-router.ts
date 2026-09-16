import { Router, type RequestHandler, type Response } from "express";
import {
  ConversationPruningError,
  type ConversationPruningService,
} from "../domains/conversation/conversation-pruning-service.js";

export type ConversationPruningApiDependencies = {
  conversationPruningService: Pick<
    ConversationPruningService,
    "deleteConversation" | "deleteBranch"
  >;
};

export function createConversationPruningApiRouter(
  dependencies: ConversationPruningApiDependencies,
): Router {
  const router = Router();

  router.delete("/:conversationId/branches/:messageId", handler(async (request) =>
    dependencies.conversationPruningService.deleteBranch({
      userId: requireUser(request.webUserId),
      conversationId: request.params.conversationId,
      messageId: request.params.messageId,
    })
  ));

  router.delete("/:conversationId", handler(async (request) =>
    dependencies.conversationPruningService.deleteConversation({
      userId: requireUser(request.webUserId),
      conversationId: request.params.conversationId,
    })
  ));

  return router;
}

function handler(
  work: (request: Parameters<RequestHandler>[0]) => Promise<unknown>,
): RequestHandler {
  return async (request, response) => {
    try {
      response.json({ success: true, data: await work(request) });
    } catch (error) {
      sendError(response, error);
    }
  };
}

function requireUser(userId: string | undefined): string {
  if (!userId) {
    throw Object.assign(new Error("Web API authentication is required."), {
      code: "UNAUTHORIZED",
    });
  }
  return userId;
}

function sendError(response: Response, error: unknown): void {
  if (error instanceof ConversationPruningError) {
    if (error.code === "CONVERSATION_PRUNE_NOT_FOUND") {
      respond(response, 404, error.code, "Conversation data was not found.");
      return;
    }
    if (error.code === "CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED") {
      respond(
        response,
        409,
        error.code,
        "This branch contains the whole conversation; delete the window instead.",
      );
      return;
    }
    if (error.code === "CONVERSATION_PRUNE_UNAVAILABLE") {
      respond(response, 403, error.code, "Conversation pruning is unavailable.");
      return;
    }
    respond(response, 400, error.code, "Conversation prune request is invalid.");
    return;
  }
  const code = typeof error === "object"
    && error !== null
    && "code" in error
    && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;
  if (code === "UNAUTHORIZED") {
    respond(response, 401, code, "Web API authentication is required.");
    return;
  }
  respond(
    response,
    503,
    "CONVERSATION_PRUNE_UNAVAILABLE",
    "Conversation pruning is temporarily unavailable.",
  );
}

function respond(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({
    success: false,
    error: { code, message },
  });
}
