import { Router, type RequestHandler, type Response } from "express";
import {
  ConversationFavoriteError,
  type ConversationFavoriteService,
} from "../domains/conversation/conversation-favorite-service.js";

export type ConversationFavoriteApiDependencies = {
  conversationFavoriteService: Pick<
    ConversationFavoriteService,
    "create" | "list" | "detail" | "update" | "delete"
  >;
};

export function createConversationFavoriteApiRouter(
  dependencies: ConversationFavoriteApiDependencies,
): Router {
  const router = Router();

  router.get("/favorites", handler(async (request) =>
    dependencies.conversationFavoriteService.list({
      userId: requireUser(request.webUserId),
      provider: request.query.provider,
      conversationId: request.query.conversation_id,
      tag: request.query.tag,
      limit: request.query.limit,
      offset: request.query.offset,
    })
  ));

  router.post("/favorites", handler(async (request) =>
    dependencies.conversationFavoriteService.create({
      userId: requireUser(request.webUserId),
      conversationId: request.body?.conversation_id,
      startMessageId: request.body?.start_message_id,
      endMessageId: request.body?.end_message_id,
      view: request.body?.view,
      title: request.body?.title,
      note: request.body?.note,
      tags: request.body?.tags,
    })
  ));

  router.get("/favorites/:favoriteId", handler(async (request) =>
    dependencies.conversationFavoriteService.detail({
      userId: requireUser(request.webUserId),
      favoriteId: request.params.favoriteId,
    })
  ));

  router.patch("/favorites/:favoriteId", handler(async (request) => {
    const body = request.body && typeof request.body === "object"
      ? request.body as Record<string, unknown>
      : {};
    return dependencies.conversationFavoriteService.update({
      userId: requireUser(request.webUserId),
      favoriteId: request.params.favoriteId,
      ...("title" in body ? { title: body.title } : {}),
      ...("note" in body ? { note: body.note } : {}),
      ...("tags" in body ? { tags: body.tags } : {}),
    });
  }));

  router.delete("/favorites/:favoriteId", handler(async (request) =>
    dependencies.conversationFavoriteService.delete({
      userId: requireUser(request.webUserId),
      favoriteId: request.params.favoriteId,
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
  if (error instanceof ConversationFavoriteError) {
    if (error.code === "CONVERSATION_FAVORITE_NOT_FOUND") {
      respond(response, 404, error.code, "Conversation favorite was not found.");
      return;
    }
    if (error.code === "CONVERSATION_FAVORITE_RANGE_TOO_LARGE") {
      respond(response, 413, error.code, "Conversation favorite range is too large.");
      return;
    }
    if (error.code === "CONVERSATION_FAVORITE_UNAVAILABLE") {
      respond(response, 403, error.code, "Conversation favorites are unavailable.");
      return;
    }
    respond(response, 400, error.code, "Conversation favorite request is invalid.");
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
    "CONVERSATION_FAVORITE_UNAVAILABLE",
    "Conversation favorites are temporarily unavailable.",
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
