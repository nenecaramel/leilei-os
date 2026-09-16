import { Router, type RequestHandler, type Response } from "express";
import {
  ConversationExclusionManagementError,
  type ConversationExclusionManagementService,
} from "../domains/conversation/conversation-exclusion-management-service.js";

export type ConversationExclusionManagementApiDependencies = {
  conversationExclusionManagementService: Pick<
    ConversationExclusionManagementService,
    "list" | "remove"
  >;
};

export function createConversationExclusionManagementApiRouter(
  dependencies: ConversationExclusionManagementApiDependencies,
): Router {
  const router = Router();

  router.get("/exclusions", handler(async (request) =>
    dependencies.conversationExclusionManagementService.list({
      userId: requireUser(request.webUserId),
      provider: request.query.provider,
      scope: request.query.scope,
      limit: request.query.limit,
      offset: request.query.offset,
    })
  ));

  router.delete("/exclusions/:exclusionId", handler(async (request) =>
    dependencies.conversationExclusionManagementService.remove({
      userId: requireUser(request.webUserId),
      exclusionId: request.params.exclusionId,
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
  if (error instanceof ConversationExclusionManagementError) {
    if (error.code === "CONVERSATION_EXCLUSION_NOT_FOUND") {
      respond(response, 404, error.code, "Conversation exclusion was not found.");
      return;
    }
    if (error.code === "CONVERSATION_EXCLUSION_UNAVAILABLE") {
      respond(response, 403, error.code, "Conversation exclusion management is unavailable.");
      return;
    }
    respond(response, 400, error.code, "Conversation exclusion request is invalid.");
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
    "CONVERSATION_EXCLUSION_UNAVAILABLE",
    "Conversation exclusion management is temporarily unavailable.",
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
