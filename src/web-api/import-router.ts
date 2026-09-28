import express, { Router, type RequestHandler, type Response } from "express";
import { ImportAuthorizationError, type ImportService } from "../domains/import/import-service.js";
import {
  ImportValidationError,
  MAX_IMPORT_PACKAGE_BYTES,
} from "../domains/import/import-schema.js";

export type ImportApiDependencies = {
  importService: Pick<ImportService, "preview" | "execute">;
};

const RAW_LIMIT = MAX_IMPORT_PACKAGE_BYTES;

export function createImportApiRouter(dependencies: ImportApiDependencies): Router {
  const router = Router();
  router.post("/preview", express.raw({ type: "application/octet-stream", limit: RAW_LIMIT }), createPreviewHandler(dependencies));
  router.post("/execute", express.raw({ type: "application/octet-stream", limit: RAW_LIMIT }), createExecuteHandler(dependencies));
  router.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (isTooLarge(error)) {
      response.status(413).json({ success: false, error: { code: "IMPORT_TOO_LARGE", message: "Import package is too large." } });
      return;
    }
    next(error);
  });
  return router;
}

function createPreviewHandler(dependencies: ImportApiDependencies): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    if (!isRawImportRequest(request)) {
      sendError(response, 400, "INVALID_IMPORT_FILE", "Import package is invalid.");
      return;
    }
    try {
      const result = await dependencies.importService.preview(request.body as Uint8Array, request.webUserId!);
      response.json({ success: true, data: result });
    } catch (error) {
      sendImportError(response, error);
    }
  };
}

function createExecuteHandler(dependencies: ImportApiDependencies): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    if (!isRawImportRequest(request)) {
      sendError(response, 400, "INVALID_IMPORT_FILE", "Import package is invalid.");
      return;
    }
    const expected = exactlyOneQueryValue(request.query.expected_preview_fingerprint);
    if (!expected) {
      sendError(response, 400, "IMPORT_PREVIEW_STALE", "Import preview is stale.");
      return;
    }
    try {
      const result = await dependencies.importService.execute(request.body as Uint8Array, request.webUserId!, expected);
      response.json({ success: true, data: result });
    } catch (error) {
      sendImportError(response, error);
    }
  };
}

function isRawImportRequest(request: express.Request): boolean {
  return request.header("content-type") === "application/octet-stream" && Buffer.isBuffer(request.body);
}

function exactlyOneQueryValue(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : undefined;
}

function isTooLarge(error: unknown): boolean {
  return typeof error === "object" && error !== null && "type" in error && (error as { type?: unknown }).type === "entity.too.large";
}

function sendImportError(response: Response, error: unknown): void {
  const code = error instanceof ImportValidationError
    ? error.code
    : typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
  if (code === "UNSUPPORTED_EXPORT_VERSION") return sendError(response, 400, code, "This export version cannot be restored.");
  if (code === "IMPORT_OWNER_MISMATCH") return sendError(response, 403, code, "Import package does not belong to this account.");
  if (code === "IMPORT_CONFLICT") return sendError(response, 409, code, "Import contains conflicts.");
  if (code === "IMPORT_PREVIEW_STALE") return sendError(response, 409, code, "Import preview is stale.");
  if (code === "IMPORT_NOTHING_TO_RESTORE") return sendError(response, 409, code, "There is nothing new to restore.");
  if (code === "IMPORT_TOO_LARGE") return sendError(response, 413, code, "Import package is too large.");
  if (code === "USER_NOT_FOUND" || code === "USER_DISABLED" || error instanceof ImportAuthorizationError) return sendError(response, 403, "IMPORT_UNAVAILABLE", "Import is unavailable for the authenticated user.");
  if (code === "INVALID_IMPORT_FILE") return sendError(response, 400, code, "Import package is invalid.");
  sendError(response, 503, "IMPORT_UNAVAILABLE", "Import is temporarily unavailable.");
}

function sendError(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ success: false, error: { code, message } });
}

function requireWebUser(response: Response, userId: string | undefined): userId is string {
  if (userId) return true;
  response.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Web API authentication is required." } });
  return false;
}
