import { createHash } from "node:crypto";
import {
  NativeLiveAttachmentError,
  type NativeLiveChatAttachment,
} from "../bridge/attachment/native-live-attachment-service.js";
import type {
  NativeLiveAttachmentDownloadSlot,
  NativeLiveAttachmentObjectStore,
} from "../bridge/attachment/native-live-attachment-storage.js";
import type {
  ClaudeAlbumPhotoPromoter,
  PromotedClaudeAlbumPhoto,
} from "./claude-photo-album-types.js";

export interface ClaudeAlbumSourceAttachmentGateway {
  createDownloadSlot(input: {
    userId: string;
    attachmentId: string;
  }): Promise<{
    attachment: NativeLiveChatAttachment;
    download: NativeLiveAttachmentDownloadSlot;
  }>;
}

export class ClaudeAlbumPhotoPromotionError extends Error {
  constructor(
    readonly code:
      | "SOURCE_ATTACHMENT_NOT_IMAGE"
      | "SOURCE_ATTACHMENT_UNAVAILABLE"
      | "SOURCE_ATTACHMENT_TOO_LARGE"
      | "SOURCE_DOWNLOAD_FAILED"
      | "ALBUM_UPLOAD_FAILED"
      | "ALBUM_UPLOAD_MISMATCH",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ClaudeAlbumPhotoPromotionError";
  }
}

export class NativeLiveClaudeAlbumPhotoPromoter
implements ClaudeAlbumPhotoPromoter {
  private readonly maxPhotoBytes: number;
  private readonly transferBaseUrl: string | null;

  constructor(
    private readonly source:
      ClaudeAlbumSourceAttachmentGateway,
    private readonly destination:
      NativeLiveAttachmentObjectStore,
    config: {
      maxPhotoBytes?: number;
      transferBaseUrl?: string | null;
    } = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.maxPhotoBytes =
      config.maxPhotoBytes ?? 20 * 1024 * 1024;
    if (
      !Number.isSafeInteger(this.maxPhotoBytes)
      || this.maxPhotoBytes <= 0
    ) {
      throw new Error("Album photo size limit is invalid.");
    }
    this.transferBaseUrl = normalizeBaseUrl(
      config.transferBaseUrl ?? null,
    );
  }

  async promote(input: {
    userId: string;
    photoId: string;
    sourceAttachmentId: string;
    triggerUserMessageId: string;
  }): Promise<PromotedClaudeAlbumPhoto> {
    let source: {
      attachment: NativeLiveChatAttachment;
      download: NativeLiveAttachmentDownloadSlot;
    };
    try {
      source = await this.source.createDownloadSlot({
        userId: input.userId,
        attachmentId: input.sourceAttachmentId,
      });
    } catch (error) {
      if (error instanceof NativeLiveAttachmentError) {
        throw new ClaudeAlbumPhotoPromotionError(
          "SOURCE_ATTACHMENT_UNAVAILABLE",
          error.code === "ATTACHMENT_NOT_READY"
            ? "That attachment is no longer available or has expired. Re-send the image if you still want to save it."
            : error.code === "ATTACHMENT_NOT_FOUND"
              ? "That attachment is no longer available. Re-send the image if you still want to save it."
              : error.message,
        );
      }
      throw error;
    }
    const attachment = source.attachment;
    if (
      attachment.kind !== "image"
      || !attachment.mimeType
        .trim()
        .toLowerCase()
        .startsWith("image/")
    ) {
      throw new ClaudeAlbumPhotoPromotionError(
        "SOURCE_ATTACHMENT_NOT_IMAGE",
        "Only image attachments can be promoted into Claude's photo album.",
      );
    }
    if (
      !Number.isSafeInteger(attachment.sizeBytes)
      || attachment.sizeBytes <= 0
      || attachment.sizeBytes > this.maxPhotoBytes
    ) {
      throw new ClaudeAlbumPhotoPromotionError(
        "SOURCE_ATTACHMENT_TOO_LARGE",
        "The source image is outside the album photo size limit.",
      );
    }

    const sourceUrl = transferUrl(
      source.download.url,
      this.transferBaseUrl,
    );
    const download = await this.fetchImpl(sourceUrl, {
      method: source.download.method,
      headers: source.download.headers,
    });
    if (!download.ok) {
      if (download.status === 404) {
        throw new ClaudeAlbumPhotoPromotionError(
          "SOURCE_ATTACHMENT_UNAVAILABLE",
          "That attachment is no longer available. Re-send the image if you still want to save it.",
        );
      }
      throw new ClaudeAlbumPhotoPromotionError(
        "SOURCE_DOWNLOAD_FAILED",
        "Source attachment download failed with HTTP "
          + download.status,
      );
    }

    const bytes = Buffer.from(await download.arrayBuffer());
    const actualSha256 = createHash("sha256")
      .update(bytes)
      .digest("hex");
    if (
      bytes.byteLength !== attachment.sizeBytes
      || actualSha256 !== attachment.sha256.toLowerCase()
    ) {
      throw new ClaudeAlbumPhotoPromotionError(
        "SOURCE_DOWNLOAD_FAILED",
        "Source attachment bytes did not match stored metadata.",
      );
    }

    const objectKey =
      "claude-album/"
      + input.userId
      + "/"
      + input.photoId;
    const upload = this.destination.createUploadSlot({
      objectKey,
      mimeType: attachment.mimeType,
      sha256: attachment.sha256,
    });

    try {
      const response = await this.fetchImpl(upload.url, {
        method: upload.method,
        headers: upload.headers,
        body: bytes,
      });
      if (!response.ok) {
        throw new ClaudeAlbumPhotoPromotionError(
          "ALBUM_UPLOAD_FAILED",
          "Album photo upload failed with HTTP "
            + response.status,
        );
      }

      const head = await this.destination.headObject({
        objectKey,
      });
      if (
        !head
        || head.sizeBytes !== attachment.sizeBytes
        || head.mimeType?.toLowerCase()
          !== attachment.mimeType.toLowerCase()
        || head.sha256?.toLowerCase()
          !== attachment.sha256.toLowerCase()
      ) {
        throw new ClaudeAlbumPhotoPromotionError(
          "ALBUM_UPLOAD_MISMATCH",
          "Album object metadata did not match the promoted photo.",
        );
      }
    } catch (error) {
      try {
        await this.destination.deleteObject({ objectKey });
      } catch {
        // Preserve the primary transfer error.
      }
      throw error;
    }

    return {
      objectKey,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      sha256: attachment.sha256.toLowerCase(),
      sourceAttachmentId: attachment.attachmentId,
      sourceMessageId: attachment.boundMessageId,
    };
  }

  async deletePromoted(input: {
    objectKey: string;
  }): Promise<void> {
    await this.destination.deleteObject(input);
  }

  createDownloadSlot(input: {
    objectKey: string;
  }): NativeLiveAttachmentDownloadSlot {
    return this.destination.createDownloadSlot(input);
  }
}

function transferUrl(
  value: string,
  baseUrl: string | null,
): string {
  try {
    return new URL(value).toString();
  } catch {
    if (!baseUrl) {
      throw new ClaudeAlbumPhotoPromotionError(
        "SOURCE_DOWNLOAD_FAILED",
        "Relative source attachment transfer URLs require a base URL.",
      );
    }
    return new URL(value, baseUrl).toString();
  }
}

function normalizeBaseUrl(value: string | null): string | null {
  if (value === null) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Album transfer base URL must use HTTP or HTTPS.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}
