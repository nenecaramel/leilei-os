import { Router, type RequestHandler, type Response } from "express";
import {
  ConversationPruningError,
  type ConversationPruningService,
} from "../domains/conversation/conversation-pruning-service.js";
import type { ConversationArchiveReadService } from "../domains/conversation/conversation-archive-read-service.js";

export type ConversationLifecycleApiDependencies = {
  conversationPruningService: Pick<ConversationPruningService,
    | "deleteConversation"
    | "archiveConversation"
    | "restoreConversation"
    | "restoreDeletedConversation"
    | "permanentlyDeleteConversation"
    | "restoreBranch"
    | "permanentlyDeleteBranch"
    | "listDeletedBranches"
  >;
  conversationArchiveReadService: Pick<ConversationArchiveReadService, "list">;
};

export function createConversationLifecycleApiRouter(
  dependencies: ConversationLifecycleApiDependencies,
): Router {
  const router = Router();
  router.get("/archive", handler(async (request) => dependencies.conversationArchiveReadService.list({
    userId: requireUser(request.webUserId),
    scope: "archived",
    limit: request.query.limit,
    offset: request.query.offset,
  })));
  router.get("/deleted", handler(async (request) => {
    const userId = requireUser(request.webUserId);
    const [conversations, branches] = await Promise.all([
      dependencies.conversationArchiveReadService.list({
        userId,
        scope: "deleted",
        limit: request.query.limit,
        offset: request.query.offset,
      }),
      dependencies.conversationPruningService.listDeletedBranches({
        userId,
        limit: request.query.limit,
        offset: request.query.offset,
      }),
    ]);
    return { conversations, branches };
  }));
  router.post("/:conversationId/archive", handler(async (request) => dependencies.conversationPruningService.archiveConversation({ userId: requireUser(request.webUserId), conversationId: request.params.conversationId })));
  router.post("/:conversationId/restore", handler(async (request) => dependencies.conversationPruningService.restoreConversation({ userId: requireUser(request.webUserId), conversationId: request.params.conversationId })));
  router.post("/:conversationId/restore-deleted", handler(async (request) => dependencies.conversationPruningService.restoreDeletedConversation({ userId: requireUser(request.webUserId), conversationId: request.params.conversationId })));
  router.post("/:conversationId/delete", handler(async (request) => dependencies.conversationPruningService.deleteConversation({ userId: requireUser(request.webUserId), conversationId: request.params.conversationId })));
  router.post("/:conversationId/permanent-delete", handler(async (request) => dependencies.conversationPruningService.permanentlyDeleteConversation({ userId: requireUser(request.webUserId), conversationId: request.params.conversationId })));
  router.post("/:conversationId/branches/:branchId/restore", handler(async (request) => dependencies.conversationPruningService.restoreBranch({ userId: requireUser(request.webUserId), conversationId: request.params.conversationId, branchId: request.params.branchId })));
  router.post("/:conversationId/branches/:branchId/permanent-delete", handler(async (request) => dependencies.conversationPruningService.permanentlyDeleteBranch({ userId: requireUser(request.webUserId), conversationId: request.params.conversationId, branchId: request.params.branchId })));
  return router;
}

function handler(work: (request: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler {
  return async (request, response) => {
    try { response.json({ success: true, data: await work(request) }); }
    catch (error) { sendError(response, error); }
  };
}

function requireUser(userId: string | undefined): string {
  if (!userId) throw Object.assign(new Error("Web API authentication is required."), { code: "UNAUTHORIZED" });
  return userId;
}

function sendError(response: Response, error: unknown): void {
  if (error instanceof ConversationPruningError) {
    const status = error.code === "CONVERSATION_PRUNE_NOT_FOUND" ? 404 : error.code === "CONVERSATION_PRUNE_UNAVAILABLE" ? 403 : 400;
    response.status(status).json({ success: false, error: { code: error.code, message: error.message } });
    return;
  }
  if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "UNAUTHORIZED") {
    response.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Web API authentication is required." } });
    return;
  }
  response.status(503).json({ success: false, error: { code: "CONVERSATION_LIFECYCLE_UNAVAILABLE", message: "Conversation lifecycle is temporarily unavailable." } });
}
