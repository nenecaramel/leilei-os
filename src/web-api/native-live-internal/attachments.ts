import type {
  RequestHandler,
  Response,
} from "express";
import { NativeLiveAttachmentError } from "../../domains/bridge/native-live-attachment-service.js";
import type { NativeLiveRelayInternalDependencies } from "./dependencies.js";
import {
  requireInternalUser,
  sendInvalid,
  UUID_PATTERN,
} from "./http.js";

export function createInternalAttachmentUploadSlotHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId =
      requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.attachmentService) return;
    const body = parseInternalAttachmentUploadBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }
    try {
      const result =
        await dependencies.attachmentService.createUploadSlot({
          userId,
          filename: body.filename,
          mimeType: body.mime_type,
          sizeBytes: body.size_bytes,
          sha256: body.sha256,
          kind: body.kind,
        });
      response.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      sendInternalAttachmentError(response, error);
    }
  };
}

export function completeInternalAttachmentUploadHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId =
      requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.attachmentService) return;
    const attachmentId =
      typeof request.params.attachmentId === "string"
        ? request.params.attachmentId
        : "";
    if (!UUID_PATTERN.test(attachmentId)) {
      sendInvalid(response);
      return;
    }
    try {
      const attachment =
        await dependencies.attachmentService.completeUpload({
          userId,
          attachmentId,
        });
      response.json({
        success: true,
        data: { attachment },
      });
    } catch (error) {
      sendInternalAttachmentError(response, error);
    }
  };
}

export function createInternalAttachmentDownloadSlotHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId =
      requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.attachmentService) return;
    const attachmentId =
      typeof request.params.attachmentId === "string"
        ? request.params.attachmentId
        : "";
    if (!UUID_PATTERN.test(attachmentId)) {
      sendInvalid(response);
      return;
    }
    try {
      const result =
        await dependencies.attachmentService.createDownloadSlot({
          userId,
          attachmentId,
        });
      response.json({
        success: true,
        data: result,
      });
    } catch (error) {
      sendInternalAttachmentError(response, error);
    }
  };
}

function parseInternalAttachmentUploadBody(
  value: unknown,
): {
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  kind: "image" | "file";
} | null {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    return null;
  }
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  const allowed = new Set([
    "filename",
    "mime_type",
    "size_bytes",
    "sha256",
    "kind",
  ]);
  if (
    keys.length !== allowed.size
    || keys.some((key) => !allowed.has(key))
    || typeof body.filename !== "string"
    || typeof body.mime_type !== "string"
    || typeof body.size_bytes !== "number"
    || typeof body.sha256 !== "string"
    || (body.kind !== "image" && body.kind !== "file")
  ) {
    return null;
  }
  return {
    filename: body.filename,
    mime_type: body.mime_type,
    size_bytes: body.size_bytes,
    sha256: body.sha256,
    kind: body.kind,
  };
}

function sendInternalAttachmentError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveAttachmentError) {
    const status =
      error.code === "INVALID_ATTACHMENT"
        ? 400
        : error.code === "ATTACHMENT_LIMIT_EXCEEDED"
          ? 413
          : error.code === "ATTACHMENT_NOT_FOUND"
            ? 404
            : error.code === "ATTACHMENT_STORAGE_UNAVAILABLE"
              ? 503
              : 409;
    response.status(status).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_ATTACHMENT_UNAVAILABLE",
      message: "Native live attachment storage is temporarily unavailable.",
    },
  });
}
