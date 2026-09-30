import assert from "node:assert/strict";
import test from "node:test";
import {
  S3PresignedAttachmentObjectStore,
} from "../src/domains/bridge/native-live-attachment-storage.js";

const config = {
  bucket: "leilei-files-test",
  endpoint: "https://t3.storageapi.dev",
  accessKeyId: "ACCESS123",
  secretAccessKey: "SECRET456",
  region: "auto",
  presignTtlSeconds: 600,
  maxFileBytes: 20 * 1024 * 1024,
  maxPerTurn: 8,
  unboundTtlSeconds: 24 * 60 * 60,
};

test("attachment presigner uses Railway virtual-host style without leaking secret", () => {
  const store = new S3PresignedAttachmentObjectStore(
    config,
    fetch,
    () => new Date("2026-09-30T03:00:00.000Z"),
  );
  const slot = store.createUploadSlot({
    objectKey: "native-live/user/attachment",
    mimeType: "image/jpeg",
    sha256: "a".repeat(64),
  });

  const url = new URL(slot.url);
  assert.equal(
    url.host,
    "leilei-files-test.t3.storageapi.dev",
  );
  assert.equal(
    url.pathname,
    "/native-live/user/attachment",
  );
  assert.equal(
    slot.headers["content-type"],
    "image/jpeg",
  );
  assert.equal(
    slot.headers["x-amz-meta-sha256"],
    "a".repeat(64),
  );
  assert.equal(
    url.searchParams.get("X-Amz-Expires"),
    "600",
  );
  assert.equal(
    slot.url.includes(config.secretAccessKey),
    false,
  );
});


test("attachment object deletion signs DELETE and treats success as terminal", async () => {
  let observedMethod: string | undefined;
  let observedURL: string | undefined;
  const store = new S3PresignedAttachmentObjectStore(
    config,
    async (input, init) => {
      observedURL =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      observedMethod = init?.method;
      return new Response(null, { status: 204 });
    },
    () => new Date("2026-09-30T03:00:00.000Z"),
  );

  await store.deleteObject({
    objectKey: "native-live/user/expired",
  });

  assert.equal(observedMethod, "DELETE");
  assert.ok(observedURL);
  const url = new URL(observedURL!);
  assert.equal(
    url.pathname,
    "/native-live/user/expired",
  );
  assert.equal(
    url.searchParams.get("X-Amz-Algorithm"),
    "AWS4-HMAC-SHA256",
  );
});
