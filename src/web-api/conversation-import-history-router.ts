import { Router, type RequestHandler, type Response } from "express";
import {
  ConversationImportHistoryError,
  type ConversationImportHistoryService,
} from "../domains/conversation/conversation-import-history-service.js";

export type ConversationImportHistoryApiDependencies = {
  conversationImportHistoryService: Pick<
    ConversationImportHistoryService,
    "list" | "get"
  >;
};

export function createConversationImportHistoryApiRouter(
  dependencies: ConversationImportHistoryApiDependencies,
): Router {
  const router = Router();

  router.get("/import/sources", handler(async (request) =>
    dependencies.conversationImportHistoryService.list({
      userId: requireUser(request.webUserId),
      provider: request.query.provider,
      limit: request.query.limit,
      offset: request.query.offset,
    })
  ));

  router.get("/import/sources/:sourceId", handler(async (request) =>
    dependencies.conversationImportHistoryService.get({
      userId: requireUser(request.webUserId),
      sourceId: request.params.sourceId,
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
  if (error instanceof ConversationImportHistoryError) {
    if (error.code === "CONVERSATION_IMPORT_HISTORY_NOT_FOUND") {
      respond(response, 404, error.code, "Conversation import source was not found.");
      return;
    }
    if (error.code === "CONVERSATION_IMPORT_HISTORY_UNAVAILABLE") {
      respond(response, 403, error.code, "Conversation import history is unavailable.");
      return;
    }
    respond(response, 400, error.code, "Conversation import history request is invalid.");
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
    "CONVERSATION_IMPORT_HISTORY_UNAVAILABLE",
    "Conversation import history is temporarily unavailable.",
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
