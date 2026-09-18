import { Router, type RequestHandler, type Response } from "express";
import {
  ConversationArchiveReadError,
  type ConversationArchiveReadService,
} from "../domains/conversation/conversation-archive-read-service.js";

export type ConversationArchiveReadApiDependencies = {
  conversationArchiveReadService: Pick<
    ConversationArchiveReadService,
    "list" | "detail" | "messages" | "stats" | "search" | "messageContext"
  >;
};

export function createConversationArchiveReadApiRouter(
  dependencies: ConversationArchiveReadApiDependencies,
): Router {
  const router = Router();

  router.get("/", handler(async (request) =>
    dependencies.conversationArchiveReadService.list({
      userId: requireUser(request.webUserId),
      provider: request.query.provider,
      limit: request.query.limit,
      offset: request.query.offset,
      scope: request.query.scope,
    })
  ));

  router.get("/search", handler(async (request) =>
    dependencies.conversationArchiveReadService.search({
      userId: requireUser(request.webUserId),
      query: request.query.q,
      provider: request.query.provider,
      role: request.query.role,
      conversationId: request.query.conversation_id,
      from: request.query.from,
      to: request.query.to,
      timeZone: request.query.time_zone,
      favoritesOnly: request.query.favorites_only,
      scope: request.query.scope,
      limit: request.query.limit,
      offset: request.query.offset,
    })
  ));

  router.get("/stats/daily", handler(async (request) =>
    dependencies.conversationArchiveReadService.stats({
      userId: requireUser(request.webUserId),
      from: request.query.from,
      to: request.query.to,
      timeZone: request.query.time_zone,
    })
  ));

  router.get("/:conversationId/messages/:messageId/context", handler(async (request) =>
    dependencies.conversationArchiveReadService.messageContext({
      userId: requireUser(request.webUserId),
      conversationId: request.params.conversationId,
      messageId: request.params.messageId,
      scope: request.query.scope,
      branchId: request.query.branch_id,
      view: request.query.view,
      radius: request.query.radius,
    })
  ));

  router.get("/:conversationId/messages", handler(async (request) =>
    dependencies.conversationArchiveReadService.messages({
      userId: requireUser(request.webUserId),
      conversationId: request.params.conversationId,
      view: request.query.view,
      limit: request.query.limit,
      offset: request.query.offset,
      scope: request.query.scope,
      branchId: request.query.branch_id,
    })
  ));

  router.get("/:conversationId", handler(async (request) =>
    dependencies.conversationArchiveReadService.detail({
      userId: requireUser(request.webUserId),
      conversationId: request.params.conversationId,
      scope: request.query.scope,
      branchId: request.query.branch_id,
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
  if (error instanceof ConversationArchiveReadError) {
    if (error.code === "CONVERSATION_NOT_FOUND") {
      respond(response, 404, error.code, "Conversation was not found.");
      return;
    }
    if (error.code === "CONVERSATION_UNAVAILABLE") {
      respond(response, 403, error.code, "Conversation Archive is unavailable.");
      return;
    }
    respond(response, 400, error.code, "Conversation request is invalid.");
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
    "CONVERSATION_UNAVAILABLE",
    "Conversation Archive is temporarily unavailable.",
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
