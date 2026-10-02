import { Router, type RequestHandler, type Response } from "express";
import {
  ClaudePhotoAlbumError,
  type ClaudePhotoAlbumService,
} from "../domains/album/claude-photo-album-service.js";

export type AlbumApiDependencies = {
  albumService: Pick<
    ClaudePhotoAlbumService,
    "readMessageSaves"
  >;
};

export function createAlbumApiRouter(
  dependencies: AlbumApiDependencies,
): Router {
  const router = Router();

  router.get(
    "/saves/messages/:messageId",
    handler(async (request) =>
      dependencies.albumService.readMessageSaves({
        userId: request.webUserId!,
        userMessageId: routeParam(
          request.params.messageId,
        ),
      })),
  );

  return router;
}

function handler(
  operation: (
    request: Parameters<RequestHandler>[0],
  ) => Promise<unknown>,
): RequestHandler {
  return async (request, response) => {
    try {
      response.json({
        success: true,
        data: await operation(request),
      });
    } catch (error) {
      sendError(response, error);
    }
  };
}

function routeParam(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ClaudePhotoAlbumError(
      "INVALID_ALBUM_PHOTO",
      "messageId is required.",
    );
  }
  return value;
}

function sendError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof ClaudePhotoAlbumError) {
    response.status(
      error.code === "ALBUM_PHOTO_NOT_FOUND"
        ? 404
        : 400,
    ).json({
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
      code: "ALBUM_UNAVAILABLE",
      message: "Claude album is temporarily unavailable.",
    },
  });
}
