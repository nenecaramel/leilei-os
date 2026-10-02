import { randomUUID } from "node:crypto";
import type {
  ClaudeAlbumPhoto,
  ClaudeAlbumPhotoPromoter,
  ClaudeAlbumPhotoRepository,
} from "./claude-photo-album-types.js";

export class ClaudePhotoAlbumError extends Error {
  constructor(
    readonly code:
      | "INVALID_ALBUM_PHOTO"
      | "ALBUM_PHOTO_NOT_FOUND",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ClaudePhotoAlbumError";
  }
}

export class ClaudePhotoAlbumService {
  constructor(
    private readonly repository: ClaudeAlbumPhotoRepository,
    private readonly promoter: ClaudeAlbumPhotoPromoter,
    private readonly createId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async savePhoto(input: {
    userId: string;
    sourceAttachmentId: unknown;
    triggerUserMessageId: unknown;
    description?: unknown;
    whySaved: unknown;
    tags?: unknown;
  }): Promise<{
    photo: ClaudeAlbumPhoto;
    created: boolean;
  }> {
    requireUuid(input.userId, "userId");
    const sourceAttachmentId = uuid(
      input.sourceAttachmentId,
      "sourceAttachmentId",
    );
    const triggerUserMessageId = uuid(
      input.triggerUserMessageId,
      "triggerUserMessageId",
    );
    const description = optionalText(
      input.description,
      2_000,
      "description",
    );
    const whySaved = requiredText(
      input.whySaved,
      4_000,
      "whySaved",
    );
    const tags = normalizeTags(input.tags);

    const existing =
      await this.repository.findBySourceAttachment({
        userId: input.userId,
        sourceAttachmentId,
      });
    if (existing) {
      return { photo: existing, created: false };
    }

    const photoId = this.createId();
    requireUuid(photoId, "generated photo id");
    const promoted = await this.promoter.promote({
      userId: input.userId,
      photoId,
      sourceAttachmentId,
      triggerUserMessageId,
    });
    const photo: ClaudeAlbumPhoto = {
      id: photoId,
      userId: input.userId,
      objectKey: promoted.objectKey,
      filename: promoted.filename,
      mimeType: promoted.mimeType,
      sizeBytes: promoted.sizeBytes,
      sha256: promoted.sha256,
      description,
      whySaved,
      tags,
      sourceAttachmentId: promoted.sourceAttachmentId,
      sourceMessageId: promoted.sourceMessageId,
      triggerUserMessageId,
      createdAt: this.now().toISOString(),
    };

    try {
      const result = await this.repository.create({ photo });
      if (result.outcome === "created") {
        return { photo: result.photo, created: true };
      }
      await this.bestEffortDelete(promoted.objectKey);
      return { photo: result.photo, created: false };
    } catch (error) {
      await this.bestEffortDelete(promoted.objectKey);
      throw error;
    }
  }

  async searchPhotos(input: {
    userId: string;
    query?: unknown;
    limit?: unknown;
  }): Promise<ClaudeAlbumPhoto[]> {
    requireUuid(input.userId, "userId");
    const query = optionalText(input.query, 500, "query");
    const limit = normalizeLimit(input.limit);
    return this.repository.search({
      userId: input.userId,
      query,
      limit,
    });
  }

  async readMessageSaves(input: {
    userId: string;
    userMessageId: unknown;
  }) {
    requireUuid(input.userId, "userId");
    const userMessageId = uuid(
      input.userMessageId,
      "userMessageId",
    );
    const total =
      await this.repository.countByTriggerUserMessage({
        userId: input.userId,
        userMessageId,
      });
    return { userMessageId, total };
  }

  async getPhoto(input: {
    userId: string;
    photoId: unknown;
  }): Promise<ClaudeAlbumPhoto> {
    requireUuid(input.userId, "userId");
    const photoId = uuid(input.photoId, "photoId");
    const photo = await this.repository.get({
      userId: input.userId,
      photoId,
    });
    if (!photo) {
      throw new ClaudePhotoAlbumError("ALBUM_PHOTO_NOT_FOUND");
    }
    return photo;
  }

  async createPhotoDownload(input: {
    userId: string;
    photoId: unknown;
  }) {
    const photo = await this.getPhoto(input);
    return {
      photo,
      download: this.promoter.createDownloadSlot({
        objectKey: photo.objectKey,
      }),
    };
  }

  private async bestEffortDelete(objectKey: string): Promise<void> {
    try {
      await this.promoter.deletePromoted({ objectKey });
    } catch {
      // Preserve the original repository outcome. A later storage sweep can
      // remove an orphaned object if cleanup itself is unavailable.
    }
  }
}

function requiredText(
  value: unknown,
  maxLength: number,
  label: string,
): string {
  if (typeof value !== "string") {
    invalid(`${label} must be text.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    invalid(`${label} is invalid.`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  maxLength: number,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    invalid(`${label} must be text.`);
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    invalid(`${label} is too long.`);
  }
  return normalized;
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 12) {
    invalid("tags must be an array with at most 12 entries.");
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") {
      invalid("tags must contain only text.");
    }
    const tag = raw.trim();
    if (!tag || tag.length > 80) {
      invalid("Each tag must contain 1-80 characters.");
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) return 20;
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 1
    || value > 100
  ) {
    invalid("limit must be an integer between 1 and 100.");
  }
  return value;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string") {
    invalid(`${label} must be a UUID.`);
  }
  requireUuid(value, label);
  return value;
}

function requireUuid(value: string, label: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  ) {
    invalid(`${label} must be a UUID.`);
  }
}

function invalid(message: string): never {
  throw new ClaudePhotoAlbumError(
    "INVALID_ALBUM_PHOTO",
    message,
  );
}
