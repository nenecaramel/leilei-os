import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacRuntimeExecutor,
} from "../src/domains/bridge/mac/native-live-mac-runtime-executor.js";
import {
  command,
} from "./helpers/native-live-mac-runtime-executor-fixtures.js";

test("protocol v4 collects explicit send_file output attachment ids", async () => {
  const attachmentId =
    "66666666-6666-4666-8666-666666666666";
  const sent: unknown[] = [];
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        sendFileHandler?: (input: {
          path: string;
          displayName: string | null;
        }) => Promise<{
          attachmentId: string;
          filename: string;
          mimeType: string;
          sizeBytes: number;
          sha256: string;
          kind: "image" | "file";
        }>;
      },
    ) {
      assert.equal(typeof options.sendFileHandler, "function");
      const attachment = await options.sendFileHandler!({
        path: "out/report.pdf",
        displayName: "report.pdf",
      });
      assert.equal(attachment.attachmentId, attachmentId);
      return {
        providerSessionId: "provider-output",
        normalizedEvents: [],
      };
    },
  };
  const sender = {
    async sendFile(input: {
      path: string;
      displayName?: string | null;
      workingDirectory: string;
    }) {
      sent.push(input);
      return {
        attachmentId,
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 321,
        sha256: "a".repeat(64),
        kind: "file" as const,
      };
    },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(
      runtime,
      "/workspace",
      null,
      sender,
    ).execute(
      command({ protocol_version: 4 }),
    );

  assert.equal(result.status, "success");
  if (result.status !== "success") {
    throw new Error("expected success");
  }
  assert.deepEqual(sent, [{
    path: "out/report.pdf",
    displayName: "report.pdf",
    workingDirectory: "/workspace",
  }]);
  assert.deepEqual(
    result.output_attachment_ids,
    [attachmentId],
  );
  assert.equal(
    result.output_attachment_metadata,
    undefined,
  );
});

test("protocol v3 album save is bound to canonical user identity and emits album_saved", async () => {
  const observed: unknown[] = [];
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        albumHandlers?: {
          savePhoto(input: {
            sourceAttachmentId: string;
            description: string | null;
            whySaved: string;
            tags: string[];
          }): Promise<{
            photo: {
              id: string;
              filename: string;
              mimeType: string;
              sizeBytes: number;
              sha256: string;
              description: string | null;
              whySaved: string;
              tags: string[];
              sourceAttachmentId: string;
              sourceMessageId: string | null;
              createdAt: string;
            };
            created: boolean;
          }>;
        };
      },
    ) {
      await options.albumHandlers!.savePhoto({
        sourceAttachmentId:
          "99999999-9999-4999-8999-999999999999",
        description: null,
        whySaved: "keep",
        tags: [],
      });
      return {
        providerSessionId: "provider-album-save",
        normalizedEvents: [],
      };
    },
  };
  const albumClient = {
    async savePhoto(input: {
      sourceAttachmentId: string;
      triggerUserMessageId: string;
      description: string | null;
      whySaved: string;
      tags: string[];
    }) {
      observed.push(input);
      return {
        created: true,
        photo: {
          id: "88888888-8888-4888-8888-888888888888",
          filename: "favorite.webp",
          mimeType: "image/webp",
          sizeBytes: 42,
          sha256: "a".repeat(64),
          description: null,
          whySaved: input.whySaved,
          tags: [],
          sourceAttachmentId: input.sourceAttachmentId,
          sourceMessageId: null,
          createdAt: "2026-10-02T04:00:00.000Z",
        },
      };
    },
    async searchPhotos() {
      return [];
    },
    async viewPhoto() {
      throw new Error("unused");
    },
    async sendPhoto() {
      throw new Error("unused");
    },
  };
  const events: unknown[] = [];
  const result =
    await new NativeLiveMacRuntimeExecutor(
      runtime,
      "/workspace",
      null,
      null,
      null,
      albumClient,
    ).execute(
      command({ protocol_version: 4 }),
      {
        onNormalizedEvent: async (event) => {
          events.push(event);
        },
      },
    );

  assert.equal(result.status, "success");
  const expectedUserMessageId =
    command({ protocol_version: 4 })
      .canonical_user_message_id;
  assert.deepEqual(observed, [{
    sourceAttachmentId:
      "99999999-9999-4999-8999-999999999999",
    triggerUserMessageId: expectedUserMessageId,
    description: null,
    whySaved: "keep",
    tags: [],
  }]);
  assert.deepEqual(events, [{
    type: "runtime",
    payload: {
      kind: "album_saved",
      photo_id:
        "88888888-8888-4888-8888-888888888888",
      filename: "favorite.webp",
      source_attachment_id:
        "99999999-9999-4999-8999-999999999999",
      user_message_uuid: expectedUserMessageId,
    },
  }]);
});

test("protocol v3 album save retry does not emit a duplicate album_saved event", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        albumHandlers?: {
          savePhoto(input: {
            sourceAttachmentId: string;
            description: string | null;
            whySaved: string;
            tags: string[];
          }): Promise<{
            photo: {
              id: string;
              filename: string;
              mimeType: string;
              sizeBytes: number;
              sha256: string;
              description: string | null;
              whySaved: string;
              tags: string[];
              sourceAttachmentId: string;
              sourceMessageId: string | null;
              createdAt: string;
            };
            created: boolean;
          }>;
        };
      },
    ) {
      await options.albumHandlers!.savePhoto({
        sourceAttachmentId:
          "99999999-9999-4999-8999-999999999999",
        description: null,
        whySaved: "keep",
        tags: [],
      });
      return {
        providerSessionId: "provider-album-retry",
        normalizedEvents: [],
      };
    },
  };
  const albumClient = {
    async savePhoto(input: {
      sourceAttachmentId: string;
      triggerUserMessageId: string;
      description: string | null;
      whySaved: string;
      tags: string[];
    }) {
      return {
        created: false,
        photo: {
          id: "88888888-8888-4888-8888-888888888888",
          filename: "favorite.webp",
          mimeType: "image/webp",
          sizeBytes: 42,
          sha256: "a".repeat(64),
          description: null,
          whySaved: input.whySaved,
          tags: [],
          sourceAttachmentId: input.sourceAttachmentId,
          sourceMessageId: input.triggerUserMessageId,
          createdAt: "2026-10-02T04:00:00.000Z",
        },
      };
    },
    async searchPhotos() {
      return [];
    },
    async viewPhoto() {
      throw new Error("unused");
    },
    async sendPhoto() {
      throw new Error("unused");
    },
  };
  const events: unknown[] = [];

  const result =
    await new NativeLiveMacRuntimeExecutor(
      runtime,
      "/workspace",
      null,
      null,
      null,
      albumClient,
    ).execute(
      command({ protocol_version: 4 }),
      {
        onNormalizedEvent: async (event) => {
          events.push(event);
        },
      },
    );

  assert.equal(result.status, "success");
  assert.deepEqual(events, []);
});

test("protocol v3 album send contributes to output attachment ids", async () => {
  const attachmentId =
    "77777777-7777-4777-8777-777777777777";
  const photoId =
    "88888888-8888-4888-8888-888888888888";
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        albumHandlers?: {
          sendPhoto(input: {
            photoId: string;
          }): Promise<{
            photo: {
              id: string;
              filename: string;
              mimeType: string;
              sizeBytes: number;
              sha256: string;
              description: string | null;
              whySaved: string;
              tags: string[];
              sourceAttachmentId: string;
              sourceMessageId: string | null;
              createdAt: string;
            };
            attachment: {
              attachmentId: string;
              filename: string;
              mimeType: string;
              sizeBytes: number;
              sha256: string;
              kind: "image";
            };
          }>;
        };
      },
    ) {
      assert.equal(
        typeof options.albumHandlers?.sendPhoto,
        "function",
      );
      const result =
        await options.albumHandlers!.sendPhoto({
          photoId,
        });
      assert.equal(
        result.attachment.attachmentId,
        attachmentId,
      );
      return {
        providerSessionId: "provider-album",
        normalizedEvents: [],
      };
    },
  };
  const albumClient = {
    async savePhoto() {
      throw new Error("unused");
    },
    async searchPhotos() {
      return [];
    },
    async sendPhoto(input: { photoId: string }) {
      assert.equal(input.photoId, photoId);
      return {
        photo: {
          id: photoId,
          filename: "favorite.webp",
          mimeType: "image/webp",
          sizeBytes: 42,
          sha256: "a".repeat(64),
          description: "window light",
          whySaved: "keep",
          tags: [],
          sourceAttachmentId:
            "99999999-9999-4999-8999-999999999999",
          sourceMessageId: null,
          createdAt: "2026-10-02T04:00:00.000Z",
        },
        attachment: {
          attachmentId,
          filename: "favorite.webp",
          mimeType: "image/webp",
          sizeBytes: 42,
          sha256: "a".repeat(64),
          kind: "image" as const,
        },
      };
    },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(
      runtime,
      "/workspace",
      null,
      null,
      null,
      albumClient,
    ).execute(
      command({ protocol_version: 4 }),
    );

  assert.equal(result.status, "success");
  if (result.status !== "success") {
    throw new Error("expected success");
  }
  assert.deepEqual(
    result.output_attachment_ids,
    [attachmentId],
  );
});

test("retired protocol turns fail before runtime execution", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        sendFileHandler?: unknown;
      },
    ) {
      assert.equal(options.sendFileHandler, undefined);
      return {
        providerSessionId: "provider-legacy",
        normalizedEvents: [],
      };
    },
  };
  const sender = {
    async sendFile() {
      throw new Error("legacy turn must not send files");
    },
  };

  await assert.rejects(
    new NativeLiveMacRuntimeExecutor(runtime, "/directory", null, sender).execute(command({ protocol_version: 3 })),
    /Unsupported runtime protocol version/,
  );
});
test("protocol v4 preserves the disabled send_file capability", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        sendFileHandler?: unknown;
      },
    ) {
      assert.equal(options.sendFileHandler, undefined);
      return {
        providerSessionId: "provider-legacy",
        normalizedEvents: [],
      };
    },
  };
  const sender = {
    async sendFile() {
      throw new Error("legacy turn must not send files");
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime, "/directory", null, sender).execute(command({ protocol_version: 4, output_attachments_enabled: false }));
  assert.equal(result.status, "success");
});
