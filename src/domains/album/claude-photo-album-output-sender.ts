import { createHash } from "node:crypto";
import type {
  NativeLiveAttachmentService,
} from "../bridge/native-live-attachment-service.js";
import type {
  ClaudePhotoAlbumService,
} from "./claude-photo-album-service.js";
import type {
  ClaudeAlbumPhoto,
} from "./claude-photo-album-types.js";

export class ClaudeAlbumPhotoAttachmentSendError extends Error {
  constructor(
    readonly code:
      | "ALBUM_DOWNLOAD_FAILED"
      | "ALBUM_DOWNLOAD_MISMATCH"
      | "ATTACHMENT_UPLOAD_FAILED"
      | "ATTACHMENT_UPLOAD_MISMATCH",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ClaudeAlbumPhotoAttachmentSendError";
  }
}

export class ClaudeAlbumPhotoAttachmentSender {
  private readonly transferBaseUrl: string | null;

  constructor(
    private readonly album:
      Pick<ClaudePhotoAlbumService, "createPhotoDownload">,
    private readonly attachments:
      Pick<
        NativeLiveAttachmentService,
        "createUploadSlot" | "completeUpload"
      >,
    config: {
      transferBaseUrl?: string | null;
    } = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.transferBaseUrl = normalizeBaseUrl(
      config.transferBaseUrl ?? null,
    );
  }

  async sendPhoto(input: {
    userId: string;
    photoId: string;
  }): Promise<{
    photo: ClaudeAlbumPhoto;
    attachment: {
      attachmentId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      kind: "image";
    };
  }> {
    const source = await this.album.createPhotoDownload(input);
    const sourceUrl = transferUrl(
      source.download.url,
      this.transferBaseUrl,
    );
    const download = await this.fetchImpl(sourceUrl, {
      method: source.download.method,
      headers: source.download.headers,
    });
    if (!download.ok) {
      throw new ClaudeAlbumPhotoAttachmentSendError(
        "ALBUM_DOWNLOAD_FAILED",
        "Album photo download failed with HTTP "
          + download.status,
      );
    }

    const bytes = Buffer.from(await download.arrayBuffer());
    const sha256 = createHash("sha256")
      .update(bytes)
      .digest("hex");
    if (
      bytes.byteLength !== source.photo.sizeBytes
      || sha256 !== source.photo.sha256.toLowerCase()
    ) {
      throw new ClaudeAlbumPhotoAttachmentSendError(
        "ALBUM_DOWNLOAD_MISMATCH",
        "Album photo bytes did not match stored metadata.",
      );
    }

    const slot = await this.attachments.createUploadSlot({
      userId: input.userId,
      filename: source.photo.filename,
      mimeType: source.photo.mimeType,
      sizeBytes: source.photo.sizeBytes,
      sha256: source.photo.sha256,
      kind: "image",
    });
    const uploadUrl = transferUrl(
      slot.upload.url,
      this.transferBaseUrl,
    );
    const upload = await this.fetchImpl(uploadUrl, {
      method: slot.upload.method,
      headers: slot.upload.headers,
      body: bytes,
    });
    if (!upload.ok) {
      throw new ClaudeAlbumPhotoAttachmentSendError(
        "ATTACHMENT_UPLOAD_FAILED",
        "Album photo attachment upload failed with HTTP "
          + upload.status,
      );
    }

    const attachment =
      await this.attachments.completeUpload({
        userId: input.userId,
        attachmentId: slot.attachment.attachmentId,
      });
    if (
      attachment.attachmentId
        !== slot.attachment.attachmentId
      || attachment.sizeBytes !== source.photo.sizeBytes
      || attachment.sha256.toLowerCase()
        !== source.photo.sha256.toLowerCase()
      || attachment.kind !== "image"
    ) {
      throw new ClaudeAlbumPhotoAttachmentSendError(
        "ATTACHMENT_UPLOAD_MISMATCH",
        "Album photo attachment completion metadata changed.",
      );
    }

    return {
      photo: source.photo,
      attachment: {
        attachmentId: attachment.attachmentId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        sha256: attachment.sha256,
        kind: "image",
      },
    };
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
      throw new ClaudeAlbumPhotoAttachmentSendError(
        "ALBUM_DOWNLOAD_FAILED",
        "Relative attachment transfer URLs require a base URL.",
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
