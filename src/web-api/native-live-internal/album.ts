import type {
  RequestHandler,
  Response,
} from "express";
import { ClaudePhotoAlbumError } from "../../domains/album/claude-photo-album-service.js";
import { ClaudeAlbumPhotoPromotionError } from "../../domains/album/native-live-claude-photo-promoter.js";
import { ClaudeAlbumPhotoAttachmentSendError } from "../../domains/album/claude-photo-album-output-sender.js";
import { projectClaudeAlbumToolPhoto } from "../../domains/album/claude-photo-album-tool-contract.js";
import type { NativeLiveRelayInternalDependencies } from "./dependencies.js";
import {
  requireInternalUser,
  sendInvalid,
  UUID_PATTERN,
  isUuid,
} from "./http.js";

export function saveAlbumPhotoHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId =
      requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.photoAlbumService) return;
    const body = parseAlbumPhotoSaveBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }
    try {
      const result =
        await dependencies.photoAlbumService.savePhoto({
          userId,
          sourceAttachmentId: body.source_attachment_id,
          triggerUserMessageId: body.trigger_user_message_id,
          description: body.description,
          whySaved: body.why_saved,
          tags: body.tags,
        });
      response.status(result.created ? 201 : 200).json({
        success: true,
        data: {
          created: result.created,
          photo: projectClaudeAlbumToolPhoto(result.photo),
        },
      });
    } catch (error) {
      sendAlbumError(response, error);
    }
  };
}

export function searchAlbumPhotosHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId =
      requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.photoAlbumService) return;
    const body = parseAlbumPhotoSearchBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }
    try {
      const photos =
        await dependencies.photoAlbumService.searchPhotos({
          userId,
          query: body.query,
          limit: body.limit,
        });
      response.json({
        success: true,
        data: {
          photos: photos.map(projectClaudeAlbumToolPhoto),
        },
      });
    } catch (error) {
      sendAlbumError(response, error);
    }
  };
}

export function viewAlbumPhotoHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId =
      requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.photoAlbumService) return;
    const photoId =
      typeof request.params.photoId === "string"
        ? request.params.photoId
        : "";
    if (!UUID_PATTERN.test(photoId)) {
      sendInvalid(response);
      return;
    }
    try {
      const result =
        await dependencies.photoAlbumService.createPhotoDownload({
          userId,
          photoId,
        });
      response.json({
        success: true,
        data: {
          photo: projectClaudeAlbumToolPhoto(result.photo),
          download: result.download,
        },
      });
    } catch (error) {
      sendAlbumError(response, error);
    }
  };
}

export function sendAlbumPhotoHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId =
      requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.photoAlbumSender) return;
    const photoId =
      typeof request.params.photoId === "string"
        ? request.params.photoId
        : "";
    if (!UUID_PATTERN.test(photoId)) {
      sendInvalid(response);
      return;
    }
    try {
      const result =
        await dependencies.photoAlbumSender.sendPhoto({
          userId,
          photoId,
        });
      response.status(201).json({
        success: true,
        data: {
          photo: projectClaudeAlbumToolPhoto(result.photo),
          attachment: result.attachment,
        },
      });
    } catch (error) {
      sendAlbumError(response, error);
    }
  };
}

function parseAlbumPhotoSaveBody(
  value: unknown,
): {
  source_attachment_id: string;
  trigger_user_message_id: string;
  description: string | null;
  why_saved: string;
  tags: string[];
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "source_attachment_id",
    "trigger_user_message_id",
    "description",
    "why_saved",
    "tags",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return null;
  }
  if (
    !isUuid(record.source_attachment_id)
    || !isUuid(record.trigger_user_message_id)
    || typeof record.why_saved !== "string"
    || !record.why_saved.trim()
    || record.why_saved.trim().length > 4000
  ) {
    return null;
  }
  const description =
    record.description === undefined
    || record.description === null
      ? null
      : typeof record.description === "string"
        ? record.description
        : null;
  if (
    record.description !== undefined
    && record.description !== null
    && typeof record.description !== "string"
  ) {
    return null;
  }
  const tags =
    record.tags === undefined
      ? []
      : Array.isArray(record.tags)
        ? record.tags
        : null;
  if (
    !tags
    || tags.length > 12
    || !tags.every((tag) => typeof tag === "string")
  ) {
    return null;
  }
  return {
    source_attachment_id: record.source_attachment_id,
    trigger_user_message_id: record.trigger_user_message_id,
    description,
    why_saved: record.why_saved,
    tags: tags as string[],
  };
}

function parseAlbumPhotoSearchBody(
  value: unknown,
): {
  query: string | null;
  limit: number;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["query", "limit"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return null;
  }
  const query =
    record.query === undefined || record.query === null
      ? null
      : typeof record.query === "string"
        ? record.query
        : null;
  if (
    record.query !== undefined
    && record.query !== null
    && typeof record.query !== "string"
  ) {
    return null;
  }
  const limit = record.limit === undefined ? 20 : record.limit;
  if (
    typeof limit !== "number"
    || !Number.isInteger(limit)
    || limit < 1
    || limit > 100
  ) {
    return null;
  }
  return { query, limit };
}

function sendAlbumError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof ClaudePhotoAlbumError) {
    if (error.code === "ALBUM_PHOTO_NOT_FOUND") {
      response.status(404).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }
    response.status(400).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  if (error instanceof ClaudeAlbumPhotoPromotionError) {
    const status =
      error.code === "SOURCE_ATTACHMENT_UNAVAILABLE"
        ? 404
        : error.code === "SOURCE_ATTACHMENT_NOT_IMAGE"
          || error.code === "SOURCE_ATTACHMENT_TOO_LARGE"
          ? 400
          : 502;
    response.status(status).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  if (error instanceof ClaudeAlbumPhotoAttachmentSendError) {
    response.status(502).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  throw error;
}
