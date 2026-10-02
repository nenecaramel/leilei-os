import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  NativeLiveMacHttpRelayClient,
} from "../src/domains/bridge/native-live-mac-http-relay-client.js";

const triggerUserMessageId =
  "11111111-1111-4111-8111-111111111111";
const sourceAttachmentId =
  "22222222-2222-4222-8222-222222222222";
const photoId =
  "33333333-3333-4333-8333-333333333333";

test("Native Live album relay binds save to the canonical user message", async () => {
  let observedUrl = "";
  let observedBody: unknown = null;
  const client = new NativeLiveMacHttpRelayClient(
    "https://leileios.example",
    "relay-secret",
    async (input, init) => {
      observedUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      observedBody = JSON.parse(
        String(init?.body ?? "{}"),
      );
      return Response.json({
        success: true,
        data: {
          created: true,
          photo: {
            id: photoId,
            filename: "favorite.webp",
            mimeType: "image/webp",
            sizeBytes: 42,
            sha256: "a".repeat(64),
            description: "window",
            whySaved: "keep",
            tags: ["daily"],
            sourceAttachmentId,
            sourceMessageId: triggerUserMessageId,
            createdAt: "2026-10-02T04:00:00.000Z",
          },
        },
      });
    },
  );

  const result = await client.savePhoto({
    sourceAttachmentId,
    triggerUserMessageId,
    description: "window",
    whySaved: "keep",
    tags: ["daily"],
  });

  assert.equal(
    observedUrl,
    "https://leileios.example/internal/native-live-relay/album/photos/save",
  );
  assert.deepEqual(observedBody, {
    source_attachment_id: sourceAttachmentId,
    trigger_user_message_id: triggerUserMessageId,
    description: "window",
    why_saved: "keep",
    tags: ["daily"],
  });
  assert.equal(result.created, true);
  assert.equal(result.photo.id, photoId);
});


test("Native Live album relay previews and verifies photo bytes locally", async () => {
  const bytes = Buffer.from("preview-bytes");
  const sha256 = createHash("sha256")
    .update(bytes)
    .digest("hex");
  const seen: string[] = [];

  const client = new NativeLiveMacHttpRelayClient(
    "https://leileios.example",
    "relay-secret",
    async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      seen.push(url);
      if (url.includes("/view")) {
        return Response.json({
          success: true,
          data: {
            photo: {
              id: photoId,
              filename: "favorite.webp",
              mimeType: "image/webp",
              sizeBytes: bytes.byteLength,
              sha256,
              description: "window",
              whySaved: "keep",
              tags: ["daily"],
              sourceAttachmentId,
              sourceMessageId: triggerUserMessageId,
              createdAt: "2026-10-02T04:00:00.000Z",
            },
            download: {
              url: "https://bucket.example/favorite",
              method: "GET",
              headers: {
                authorization: "signed",
              },
            },
          },
        });
      }
      assert.equal(init?.method, "GET");
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "image/webp",
        },
      });
    },
  );

  const result = await client.viewPhoto({ photoId });

  assert.equal(result.photo.id, photoId);
  assert.equal(result.image.mimeType, "image/webp");
  assert.equal(result.image.sha256, sha256);
  assert.equal(
    result.image.data,
    bytes.toString("base64"),
  );
  assert.deepEqual(seen, [
    "https://leileios.example/internal/native-live-relay/album/photos/"
      + photoId
      + "/view",
    "https://bucket.example/favorite",
  ]);
});

test("Native Live relay surfaces backend error messages", async () => {
  const client = new NativeLiveMacHttpRelayClient(
    "https://leileios.example",
    "relay-secret",
    async () =>
      Response.json(
        {
          success: false,
          error: {
            code: "SOURCE_ATTACHMENT_UNAVAILABLE",
            message:
              "That attachment is no longer available. Re-send the image if you still want to save it.",
          },
        },
        { status: 404 },
      ),
  );

  await assert.rejects(
    client.savePhoto({
      sourceAttachmentId,
      triggerUserMessageId,
      description: null,
      whySaved: "keep",
      tags: [],
    }),
    /That attachment is no longer available/u,
  );
});
