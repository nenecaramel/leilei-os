import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ClaudePhotoAlbumService,
} from "../src/domains/album/claude-photo-album-service.js";
import type {
  ClaudeAlbumPhoto,
  ClaudeAlbumPhotoPromoter,
  ClaudeAlbumPhotoRepository,
} from "../src/domains/album/claude-photo-album-types.js";
import {
  ClaudeAlbumPhotoPromotionError,
  NativeLiveClaudeAlbumPhotoPromoter,
} from "../src/domains/album/native-live-claude-photo-promoter.js";
import {
  NativeLiveAttachmentError,
} from "../src/domains/bridge/native-live-attachment-service.js";

const userId = "11111111-1111-4111-8111-111111111111";
const attachmentId = "22222222-2222-4222-8222-222222222222";
const photoId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";

class Repository implements ClaudeAlbumPhotoRepository {
  photos = new Map<string, ClaudeAlbumPhoto>();
  failCreate = false;

  async findBySourceAttachment(input: {
    userId: string;
    sourceAttachmentId: string;
  }) {
    return [...this.photos.values()].find(
      (photo) =>
        photo.userId === input.userId
        && photo.sourceAttachmentId === input.sourceAttachmentId,
    ) ?? null;
  }

  async create(input: { photo: ClaudeAlbumPhoto }) {
    if (this.failCreate) throw new Error("database unavailable");
    const existing = await this.findBySourceAttachment({
      userId: input.photo.userId,
      sourceAttachmentId: input.photo.sourceAttachmentId,
    });
    if (existing) {
      return {
        outcome: "source_exists" as const,
        photo: existing,
      };
    }
    this.photos.set(input.photo.id, input.photo);
    return {
      outcome: "created" as const,
      photo: input.photo,
    };
  }

  async get(input: { userId: string; photoId: string }) {
    const photo = this.photos.get(input.photoId);
    return photo?.userId === input.userId ? photo : null;
  }

  async search(input: {
    userId: string;
    query: string | null;
    limit: number;
  }) {
    const query = input.query?.toLocaleLowerCase() ?? null;
    return [...this.photos.values()]
      .filter((photo) => photo.userId === input.userId)
      .filter((photo) => {
        if (!query) return true;
        return [
          photo.description ?? "",
          photo.whySaved,
          ...photo.tags,
        ].join(" ").toLocaleLowerCase().includes(query);
      })
      .slice(0, input.limit);
  }

  async countByTriggerUserMessage(input: {
    userId: string;
    userMessageId: string;
  }) {
    return [...this.photos.values()].filter(
      (photo) =>
        photo.userId === input.userId
        && photo.triggerUserMessageId === input.userMessageId,
    ).length;
  }
}

class Promoter implements ClaudeAlbumPhotoPromoter {
  promoteCount = 0;
  deleted: string[] = [];

  async promote(input: {
    userId: string;
    photoId: string;
    sourceAttachmentId: string;
    triggerUserMessageId: string;
  }) {
    this.promoteCount += 1;
    return {
      objectKey:
        `claude-album/${input.userId}/${input.photoId}`,
      filename: "memory.webp",
      mimeType: "image/webp",
      sizeBytes: 42,
      sha256: "a".repeat(64),
      sourceAttachmentId: input.sourceAttachmentId,
      sourceMessageId: messageId,
    };
  }

  async deletePromoted(input: { objectKey: string }) {
    this.deleted.push(input.objectKey);
  }

  createDownloadSlot(input: { objectKey: string }) {
    return {
      url: "https://bucket.example/" + input.objectKey,
      method: "GET" as const,
      headers: {},
      expiresAt: "2026-10-02T04:00:00.000Z",
    };
  }
}

test("Claude photo album saves one promoted image and keeps Claude's reason", async () => {
  const repository = new Repository();
  const promoter = new Promoter();
  const service = new ClaudePhotoAlbumService(
    repository,
    promoter,
    () => photoId,
    () => new Date("2026-10-02T03:30:00.000Z"),
  );

  const first = await service.savePhoto({
    userId,
    sourceAttachmentId: attachmentId,
    triggerUserMessageId: "55555555-5555-4555-8555-555555555555",
    description: "  window light  ",
    whySaved: "  I liked this moment.  ",
    tags: ["LeiLei", " daily ", "leilei"],
  });

  assert.equal(first.created, true);
  assert.equal(first.photo.id, photoId);
  assert.equal(first.photo.description, "window light");
  assert.equal(first.photo.whySaved, "I liked this moment.");
  assert.deepEqual(first.photo.tags, ["LeiLei", "daily"]);
  assert.equal(first.photo.sourceMessageId, messageId);
  assert.equal(promoter.promoteCount, 1);

  const replay = await service.savePhoto({
    userId,
    sourceAttachmentId: attachmentId,
    triggerUserMessageId: "55555555-5555-4555-8555-555555555555",
    whySaved: "A retry must not duplicate it.",
  });
  assert.equal(replay.created, false);
  assert.equal(replay.photo.id, photoId);
  assert.equal(promoter.promoteCount, 1);
});

test("album storage is cleaned if metadata persistence fails", async () => {
  const repository = new Repository();
  repository.failCreate = true;
  const promoter = new Promoter();
  const service = new ClaudePhotoAlbumService(
    repository,
    promoter,
    () => photoId,
  );

  await assert.rejects(
    service.savePhoto({
      userId,
      sourceAttachmentId: attachmentId,
      triggerUserMessageId: "55555555-5555-4555-8555-555555555555",
      whySaved: "keep",
    }),
    /database unavailable/u,
  );
  assert.deepEqual(promoter.deleted, [
    `claude-album/${userId}/${photoId}`,
  ]);
});

test("message save projection is keyed by canonical user message identity", async () => {
  const repository = new Repository();
  const promoter = new Promoter();
  const service = new ClaudePhotoAlbumService(
    repository,
    promoter,
    () => photoId,
  );
  await service.savePhoto({
    userId,
    sourceAttachmentId: attachmentId,
    triggerUserMessageId: "55555555-5555-4555-8555-555555555555",
    whySaved: "keep",
  });

  assert.deepEqual(
    await service.readMessageSaves({
      userId,
      userMessageId: "55555555-5555-4555-8555-555555555555",
    }),
    {
      userMessageId: "55555555-5555-4555-8555-555555555555",
      total: 1,
    },
  );
});

test("photo download stays metadata-only until the attachment path asks for bytes", async () => {
  const repository = new Repository();
  const promoter = new Promoter();
  const service = new ClaudePhotoAlbumService(
    repository,
    promoter,
    () => photoId,
  );
  const saved = await service.savePhoto({
    userId,
    sourceAttachmentId: attachmentId,
    triggerUserMessageId: "55555555-5555-4555-8555-555555555555",
    description: "desk",
    whySaved: "quiet",
  });

  const result = await service.createPhotoDownload({
    userId,
    photoId: saved.photo.id,
  });

  assert.equal(result.photo.whySaved, "quiet");
  assert.match(result.download.url, /claude-album/u);
});

test("native-live promoter accepts an older bound image attachment and copies verified bytes", async () => {
  const bytes = Buffer.from("photo-bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const requests: Array<{ url: string; method: string }> = [];
  let deleted = false;

  const source = {
    async createDownloadSlot() {
      return {
        attachment: {
          attachmentId,
          filename: "photo.webp",
          mimeType: "image/webp",
          sizeBytes: bytes.byteLength,
          sha256,
          kind: "image" as const,
          status: "bound" as const,
          objectKey: "native-live/source",
          boundMessageId: messageId,
          createdAt: "2026-10-02T03:00:00.000Z",
          expiresAt: "2026-10-03T03:00:00.000Z",
        },
        download: {
          url: "/api/v1/native-live/attachment-transfer/source",
          method: "GET" as const,
          headers: {},
          expiresAt: "2026-10-02T04:00:00.000Z",
        },
      };
    },
  };
  const destination = {
    createUploadSlot(input: {
      objectKey: string;
      mimeType: string;
      sha256: string;
    }) {
      assert.equal(
        input.objectKey,
        `claude-album/${userId}/${photoId}`,
      );
      assert.equal(input.sha256, sha256);
      return {
        url: "https://bucket.example/upload",
        method: "PUT" as const,
        headers: { "content-type": input.mimeType },
        expiresAt: "2026-10-02T04:00:00.000Z",
      };
    },
    createDownloadSlot(input: { objectKey: string }) {
      return {
        url: "https://bucket.example/" + input.objectKey,
        method: "GET" as const,
        headers: {},
        expiresAt: "2026-10-02T04:00:00.000Z",
      };
    },
    async headObject() {
      return {
        sizeBytes: bytes.byteLength,
        mimeType: "image/webp",
        sha256,
      };
    },
    async deleteObject() {
      deleted = true;
    },
  };

  const promoter = new NativeLiveClaudeAlbumPhotoPromoter(
    source,
    destination,
    {
      transferBaseUrl: "https://leileios.example",
      maxPhotoBytes: 1024,
    },
    async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      requests.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "PUT") {
        return new Response(null, { status: 200 });
      }
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/webp" },
      });
    },
  );

  const promoted = await promoter.promote({
    userId,
    photoId,
    sourceAttachmentId: attachmentId,
    triggerUserMessageId:
      "66666666-6666-4666-8666-666666666666",
  });

  assert.equal(promoted.sha256, sha256);
  assert.equal(promoted.sourceMessageId, messageId);
  assert.equal(deleted, false);
  assert.deepEqual(requests, [
    {
      url: "https://leileios.example/api/v1/native-live/attachment-transfer/source",
      method: "GET",
    },
    {
      url: "https://bucket.example/upload",
      method: "PUT",
    },
  ]);
});

test("native-live promoter reports a clear error for unavailable old attachments", async () => {
  const source = {
    async createDownloadSlot() {
      throw new NativeLiveAttachmentError(
        "ATTACHMENT_NOT_FOUND",
        "Attachment is not available.",
      );
    },
  };
  const destination = {
    createUploadSlot() {
      throw new Error("must not upload");
    },
    createDownloadSlot() {
      throw new Error("unused");
    },
    async headObject() {
      return null;
    },
    async deleteObject() {},
  };
  const promoter = new NativeLiveClaudeAlbumPhotoPromoter(
    source,
    destination,
  );

  await assert.rejects(
    promoter.promote({
      userId,
      photoId,
      sourceAttachmentId: attachmentId,
      triggerUserMessageId:
        "66666666-6666-4666-8666-666666666666",
    }),
    (error: unknown) =>
      error instanceof ClaudeAlbumPhotoPromotionError
      && error.code === "SOURCE_ATTACHMENT_UNAVAILABLE"
      && /Re-send the image/u.test(error.message),
  );
});

test("native-live promoter refuses non-image attachments before copying bytes", async () => {
  const source = {
    async createDownloadSlot() {
      return {
        attachment: {
          attachmentId,
          filename: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 10,
          sha256: "a".repeat(64),
          kind: "file" as const,
          status: "bound" as const,
          objectKey: "native-live/source",
          boundMessageId: messageId,
          createdAt: "2026-10-02T03:00:00.000Z",
          expiresAt: "2026-10-03T03:00:00.000Z",
        },
        download: {
          url: "https://source.example/file",
          method: "GET" as const,
          headers: {},
          expiresAt: "2026-10-02T04:00:00.000Z",
        },
      };
    },
  };
  const destination = {
    createUploadSlot() {
      throw new Error("must not upload");
    },
    createDownloadSlot() {
      throw new Error("unused");
    },
    async headObject() {
      return null;
    },
    async deleteObject() {},
  };
  const promoter = new NativeLiveClaudeAlbumPhotoPromoter(
    source,
    destination,
    {},
    async () => {
      throw new Error("must not fetch");
    },
  );

  await assert.rejects(
    promoter.promote({
      userId,
      photoId,
      sourceAttachmentId: attachmentId,
      triggerUserMessageId: messageId,
    }),
    (error: unknown) =>
      error instanceof ClaudeAlbumPhotoPromotionError
      && error.code === "SOURCE_ATTACHMENT_NOT_IMAGE",
  );
});
