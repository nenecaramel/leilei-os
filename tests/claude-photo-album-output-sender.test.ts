import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ClaudeAlbumPhotoAttachmentSender,
} from "../src/domains/album/claude-photo-album-output-sender.js";

const userId = "11111111-1111-4111-8111-111111111111";
const photoId = "22222222-2222-4222-8222-222222222222";
const attachmentId = "33333333-3333-4333-8333-333333333333";

test("album photo sender relays verified bytes into the existing output attachment path", async () => {
  const bytes = Buffer.from("album-photo");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const requests: Array<{ url: string; method: string }> = [];

  const album = {
    async createPhotoDownload() {
      return {
        photo: {
          id: photoId,
          userId,
          objectKey: "claude-album/user/photo",
          filename: "favorite.webp",
          mimeType: "image/webp",
          sizeBytes: bytes.length,
          sha256,
          description: "quiet light",
          whySaved: "I wanted to keep this moment.",
          tags: ["daily"],
          sourceAttachmentId:
            "44444444-4444-4444-8444-444444444444",
          sourceMessageId:
            "55555555-5555-4555-8555-555555555555",
          triggerUserMessageId:
            "66666666-6666-4666-8666-666666666666",
          createdAt: "2026-10-02T04:00:00.000Z",
        },
        download: {
          url: "https://bucket.example/album-photo",
          method: "GET" as const,
          headers: {},
          expiresAt: "2026-10-02T05:00:00.000Z",
        },
      };
    },
  };
  const attachments = {
    async createUploadSlot() {
      return {
        attachment: {
          attachmentId,
          filename: "favorite.webp",
          mimeType: "image/webp",
          sizeBytes: bytes.length,
          sha256,
          kind: "image" as const,
          status: "uploading" as const,
          objectKey: "native-live/output",
          boundMessageId: null,
          createdAt: "2026-10-02T04:00:00.000Z",
          expiresAt: "2026-10-03T04:00:00.000Z",
        },
        upload: {
          url: "https://bucket.example/output-photo",
          method: "PUT" as const,
          headers: {
            "content-type": "image/webp",
          },
          expiresAt: "2026-10-02T05:00:00.000Z",
        },
      };
    },
    async completeUpload() {
      return {
        attachmentId,
        filename: "favorite.webp",
        mimeType: "image/webp",
        sizeBytes: bytes.length,
        sha256,
        kind: "image" as const,
        status: "ready" as const,
        objectKey: "native-live/output",
        boundMessageId: null,
        createdAt: "2026-10-02T04:00:00.000Z",
        expiresAt: "2026-10-03T04:00:00.000Z",
      };
    },
  };

  const sender = new ClaudeAlbumPhotoAttachmentSender(
    album,
    attachments,
    {},
    async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      requests.push({
        url,
        method: init?.method ?? "GET",
      });
      if (init?.method === "PUT") {
        assert.deepEqual(
          Buffer.from(init.body as Uint8Array),
          bytes,
        );
        return new Response(null, { status: 200 });
      }
      return new Response(bytes, { status: 200 });
    },
  );

  const result = await sender.sendPhoto({ userId, photoId });
  assert.equal(result.photo.id, photoId);
  assert.equal(result.attachment.attachmentId, attachmentId);
  assert.equal(result.attachment.kind, "image");
  assert.deepEqual(requests, [
    {
      url: "https://bucket.example/album-photo",
      method: "GET",
    },
    {
      url: "https://bucket.example/output-photo",
      method: "PUT",
    },
  ]);
});
