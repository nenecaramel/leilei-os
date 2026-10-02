import type {
  RequestHandler,
  Response,
} from "express";
import { NativeLiveAttachmentError } from "../../domains/bridge/native-live-attachment-service.js";
import type { NativeLiveApiDependencies } from "./dependencies.js";
import {
  requireWebUser,
  exactBody,
  routeParam,
  UUID_PATTERN,
} from "./http.js";

export function createNativeLiveAttachmentUploadSlotHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const body = exactBody(request.body, [
      "filename",
      "mime_type",
      "size_bytes",
      "sha256",
      "kind",
    ]);
    if (
      !body
      || typeof body.filename !== "string"
      || typeof body.mime_type !== "string"
      || typeof body.size_bytes !== "number"
      || typeof body.sha256 !== "string"
      || (body.kind !== "image" && body.kind !== "file")
    ) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_ATTACHMENT",
          message: "Native Live attachment upload request is invalid.",
        },
      });
      return;
    }
    try {
      const result =
        await dependencies.attachmentService!.createUploadSlot({
          userId: request.webUserId!,
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
      sendNativeLiveAttachmentApiError(response, error);
    }
  };
}

export function completeNativeLiveAttachmentHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const attachmentId = routeParam(request.params.attachmentId);
    if (!UUID_PATTERN.test(attachmentId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_ATTACHMENT",
          message: "Native Live attachment id is invalid.",
        },
      });
      return;
    }
    try {
      const attachment =
        await dependencies.attachmentService!.completeUpload({
          userId: request.webUserId!,
          attachmentId,
        });
      response.json({
        success: true,
        data: { attachment },
      });
    } catch (error) {
      sendNativeLiveAttachmentApiError(response, error);
    }
  };
}

export function createNativeLiveAttachmentDownloadSlotHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const attachmentId = routeParam(request.params.attachmentId);
    if (!UUID_PATTERN.test(attachmentId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_ATTACHMENT",
          message: "Native Live attachment id is invalid.",
        },
      });
      return;
    }
    try {
      const result =
        await dependencies.attachmentService!.createDownloadSlot({
          userId: request.webUserId!,
          attachmentId,
        });
      response.json({
        success: true,
        data: result,
      });
    } catch (error) {
      sendNativeLiveAttachmentApiError(response, error);
    }
  };
}

function sendNativeLiveAttachmentApiError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveAttachmentError) {
    const status =
      error.code === "INVALID_ATTACHMENT"
      || error.code === "ATTACHMENT_LIMIT_EXCEEDED"
        ? 400
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
      message: "Native Live attachment service is temporarily unavailable.",
    },
  });
}
