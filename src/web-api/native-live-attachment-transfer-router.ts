import {
  Router,
  raw,
  type RequestHandler,
} from "express";
import {
  PostgresAttachmentTransferError,
  type PostgresInlineAttachmentObjectStore,
} from "../domains/bridge/attachment/native-live-attachment-postgres-storage.js";

export function createNativeLiveAttachmentTransferRouter(
  store: Pick<
    PostgresInlineAttachmentObjectStore,
    "transferMaxFileBytes" | "putTransfer" | "getTransfer"
  >,
): Router {
  const router = Router();

  router.put(
    "/:token",
    raw({
      type: "*/*",
      limit: store.transferMaxFileBytes,
    }),
    putAttachmentTransferHandler(store),
  );
  router.get(
    "/:token",
    getAttachmentTransferHandler(store),
  );

  return router;
}

function putAttachmentTransferHandler(
  store: Pick<
    PostgresInlineAttachmentObjectStore,
    "putTransfer"
  >,
): RequestHandler {
  return async (request, response) => {
    const token =
      typeof request.params.token === "string"
        ? request.params.token
        : "";
    if (!Buffer.isBuffer(request.body)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_ATTACHMENT_TRANSFER",
          message: "Attachment transfer body must be binary.",
        },
      });
      return;
    }

    try {
      await store.putTransfer({
        token,
        bytes: request.body,
        contentType:
          request.get("content-type") ?? null,
        sha256Header:
          request.get("x-leileios-sha256") ?? null,
      });
      response.status(204).end();
    } catch (error) {
      sendTransferError(response, error);
    }
  };
}

function getAttachmentTransferHandler(
  store: Pick<
    PostgresInlineAttachmentObjectStore,
    "getTransfer"
  >,
): RequestHandler {
  return async (request, response) => {
    const token =
      typeof request.params.token === "string"
        ? request.params.token
        : "";
    try {
      const content = await store.getTransfer({ token });
      response.setHeader(
        "Cache-Control",
        "private, no-store",
      );
      response.setHeader(
        "Content-Type",
        content.mimeType,
      );
      response.setHeader(
        "Content-Length",
        String(content.bytes.byteLength),
      );
      response.setHeader(
        "Content-Disposition",
        "inline; filename*=UTF-8''"
          + encodeURIComponent(content.filename),
      );
      response.status(200).send(content.bytes);
    } catch (error) {
      sendTransferError(response, error);
    }
  };
}

function sendTransferError(
  response: import("express").Response,
  error: unknown,
): void {
  if (error instanceof PostgresAttachmentTransferError) {
    response.status(error.httpStatus).json({
      success: false,
      error: {
        code: "ATTACHMENT_TRANSFER_FAILED",
        message: error.message,
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "ATTACHMENT_TRANSFER_UNAVAILABLE",
      message: "Attachment transfer is temporarily unavailable.",
    },
  });
}
