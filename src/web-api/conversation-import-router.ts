import { Router, type RequestHandler, type Response } from "express";
import {
  ConversationImportAuthorizationError,
  type ConversationImportService,
} from "../domains/conversation/conversation-import-service.js";
import { ConversationImportFileError } from "../domains/conversation/conversation-import-file.js";
import { ConversationProviderParseError } from "../domains/conversation/provider-parser.js";
import { ConversationMergePlanError } from "../domains/conversation/conversation-merge-planner.js";

export type ConversationImportApiDependencies = {
  conversationImportService: Pick<ConversationImportService, "preview">;
};

export function createConversationImportApiRouter(
  dependencies: ConversationImportApiDependencies,
): Router {
  const router = Router();
  router.post("/import/preview", createPreviewHandler(dependencies));
  return router;
}

function createPreviewHandler(
  dependencies: ConversationImportApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    if (request.header("content-type") !== "application/octet-stream") {
      sendError(
        response,
        400,
        "CONVERSATION_IMPORT_INVALID_FILE",
        "Conversation import must be uploaded as application/octet-stream.",
      );
      return;
    }
    const filename = request.header("x-leilei-filename");
    if (!filename) {
      sendError(
        response,
        400,
        "CONVERSATION_IMPORT_INVALID_FILE",
        "Conversation import filename is required.",
      );
      return;
    }

    try {
      const result = await dependencies.conversationImportService.preview(
        request,
        filename,
        request.webUserId,
      );
      response.json({ success: true, data: result });
    } catch (error) {
      sendConversationImportError(response, error);
    }
  };
}

function sendConversationImportError(response: Response, error: unknown): void {
  const code = error instanceof ConversationImportFileError
    || error instanceof ConversationMergePlanError
    ? error.code
    : error instanceof ConversationProviderParseError
      ? error.code
      : typeof error === "object"
        && error !== null
        && "code" in error
        && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;

  if (error instanceof ConversationImportAuthorizationError) {
    sendError(response, 403, "CONVERSATION_IMPORT_UNAVAILABLE", "Conversation import is unavailable.");
    return;
  }
  if (code === "CONVERSATION_IMPORT_TOO_LARGE") {
    sendError(response, 413, code, "Conversation import is too large.");
    return;
  }
  if (
    code === "CONVERSATION_IMPORT_INVALID_FILE"
    || code === "CONVERSATION_IMPORT_ZIP_UNSUPPORTED"
    || code === "CONVERSATION_IMPORT_NO_CONVERSATIONS_JSON"
    || code === "CONVERSATION_IMPORT_PROVIDER_UNKNOWN"
    || code === "CONVERSATION_IMPORT_MIXED_PROVIDERS"
    || code === "CONVERSATION_IMPORT_DUPLICATE_CONVERSATION"
    || code === "CONVERSATION_IMPORT_EMPTY"
    || code === "INVALID_CONVERSATION_EXPORT"
    || code === "DUPLICATE_CONVERSATION"
    || code === "DUPLICATE_MESSAGE_NODE"
  ) {
    sendError(response, 400, code, "Conversation import file is invalid.");
    return;
  }
  sendError(
    response,
    503,
    "CONVERSATION_IMPORT_UNAVAILABLE",
    "Conversation import is temporarily unavailable.",
  );
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({ success: false, error: { code, message } });
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
