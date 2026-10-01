import assert from "node:assert/strict";
import test from "node:test";
import {
  S3PresignedAttachmentObjectStore,
} from "../src/domains/bridge/native-live-attachment-storage.js";
import {
  PostgresInlineAttachmentObjectStore,
  PostgresAttachmentTransferError,
} from "../src/domains/bridge/native-live-attachment-postgres-storage.js";
import {
  NativeLiveAttachmentService,
} from "../src/domains/bridge/native-live-attachment-service.js";

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


test("Postgres attachment transfer slots are short-lived signed capabilities", () => {
  const store = new PostgresInlineAttachmentObjectStore(
    {} as never,
    {
      signingSecret: "postgres://secret",
      transferTtlSeconds: 600,
      maxFileBytes: 20 * 1024 * 1024,
      maxTotalBytes: 256 * 1024 * 1024,
      now: () => new Date("2026-09-30T03:00:00.000Z"),
    },
  );
  const slot = store.createUploadSlot({
    objectKey: "native-live/user/attachment",
    mimeType: "application/json",
    sha256: "b".repeat(64),
  });

  assert.equal(slot.method, "PUT");
  assert.match(
    slot.url,
    /^\/api\/v1\/native-live\/attachment-transfer\//u,
  );
  assert.equal(
    slot.headers["content-type"],
    "application/json",
  );
  assert.equal(
    slot.headers["x-leileios-sha256"],
    "b".repeat(64),
  );

  const token = slot.url.split("/").at(-1)!;
  assert.deepEqual(
    store.authorizeTransfer(token, "PUT"),
    {
      version: 1,
      method: "PUT",
      objectKey: "native-live/user/attachment",
      expiresAt: 1790737800,
    },
  );

  assert.throws(
    () => store.authorizeTransfer(token, "GET"),
    PostgresAttachmentTransferError,
  );
});

test("expired Postgres attachment transfer capabilities are rejected", () => {
  const issuer = new PostgresInlineAttachmentObjectStore(
    {} as never,
    {
      signingSecret: "postgres://secret",
      transferTtlSeconds: 60,
      maxFileBytes: 20 * 1024 * 1024,
      maxTotalBytes: 256 * 1024 * 1024,
      now: () => new Date("2026-09-30T03:00:00.000Z"),
    },
  );
  const slot = issuer.createDownloadSlot({
    objectKey: "native-live/user/attachment",
  });
  const token = slot.url.split("/").at(-1)!;

  const reader = new PostgresInlineAttachmentObjectStore(
    {} as never,
    {
      signingSecret: "postgres://secret",
      transferTtlSeconds: 60,
      maxFileBytes: 20 * 1024 * 1024,
      maxTotalBytes: 256 * 1024 * 1024,
      now: () => new Date("2026-09-30T03:01:01.000Z"),
    },
  );
  assert.throws(
    () => reader.authorizeTransfer(token, "GET"),
    (error: unknown) =>
      error instanceof PostgresAttachmentTransferError
      && error.httpStatus === 410,
  );
});


test("attachment service keeps legacy inline downloads readable after bucket cutover", async () => {
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    objectKey: "native-live/user/attachment",
    content: Buffer.from("legacy"),
    filename: "legacy.txt",
    mimeType: "text/plain",
    sizeBytes: 6,
    sha256: "a".repeat(64),
    kind: "file",
    status: "bound",
    boundMessageId: "33333333-3333-4333-8333-333333333333",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    readyAt: new Date("2026-10-01T00:00:00.000Z"),
    boundAt: new Date("2026-10-01T00:00:00.000Z"),
    failedAt: null,
    expiresAt: new Date("2026-10-02T00:00:00.000Z"),
  };
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  return [row];
                },
              };
            },
          };
        },
      };
    },
  };
  const primary = {
    createUploadSlot() {
      throw new Error("unused");
    },
    createDownloadSlot() {
      return {
        url: "https://bucket.example/object",
        method: "GET" as const,
        headers: {},
        expiresAt: "2026-10-01T01:00:00.000Z",
      };
    },
    async headObject() {
      return null;
    },
    async deleteObject() {},
  };
  const legacy = {
    ...primary,
    createDownloadSlot() {
      return {
        url: "/api/v1/native-live/attachment-transfer/legacy",
        method: "GET" as const,
        headers: {},
        expiresAt: "2026-10-01T01:00:00.000Z",
      };
    },
  };

  const Service = NativeLiveAttachmentService as unknown as new (
    ...args: unknown[]
  ) => NativeLiveAttachmentService;
  const service = new Service(
    db,
    primary,
    {
      maxFileBytes: 20 * 1024 * 1024,
      unboundTtlSeconds: 86_400,
    },
    () => new Date("2026-10-01T00:30:00.000Z"),
    () => row.id,
    legacy,
  );

  const result = await service.createDownloadSlot({
    userId: row.userId,
    attachmentId: row.id,
  });

  assert.equal(
    result.download.url,
    "/api/v1/native-live/attachment-transfer/legacy",
  );
});


test("Bucket cutover uploads and migrated downloads use only the primary store", async () => {
  const row = {
    id: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222",
    filename: "new.txt", mimeType: "text/plain", sizeBytes: 6, sha256: "a".repeat(64), kind: "file" as const,
    objectKey: "native-live/user/object", content: null, status: "bound" as string, boundMessageId: "message",
    createdAt: new Date("2026-10-01T00:00:00Z"), expiresAt: new Date("2026-10-02T00:00:00Z"),
  };
  let inserted: Record<string, unknown> | undefined;
  const db = {
    insert() { return { values(value: Record<string, unknown>) { inserted = value; return { async returning() { return [row]; } }; } }; },
    select() { return { from() { return { where() { return { async limit() { return [row]; } }; } }; } }; },
    update() { return { set(value: { status: string }) { return { where() { return { async returning() { row.status = value.status; return [row]; } }; } }; } }; },
  };
  const requests: string[] = [];
  const primary = new S3PresignedAttachmentObjectStore(config, async (_url, init) => {
    requests.push(init!.method!);
    return new Response(null, { status: 200, headers: { "content-length": "6", "content-type": "text/plain", "x-amz-meta-sha256": "a".repeat(64) } });
  });
  const legacy = {
    createUploadSlot() { throw new Error("new upload must not fall back"); },
    createDownloadSlot() { throw new Error("migrated download must not fall back"); },
    async headObject() { throw new Error("new complete must not fall back"); },
    async deleteObject() {},
  };
  const service = new NativeLiveAttachmentService(db as never, primary, { maxFileBytes: 1024, unboundTtlSeconds: 600 }, () => new Date("2026-10-01T00:30:00Z"), () => row.id, legacy);
  const upload = await service.createUploadSlot({ userId: row.userId, filename: row.filename, mimeType: row.mimeType, sizeBytes: row.sizeBytes, sha256: row.sha256 });
  assert.equal(new URL(upload.upload.url).hostname, "leilei-files-test.t3.storageapi.dev");
  assert.equal(inserted!.content, undefined);
  const download = await service.createDownloadSlot({ userId: row.userId, attachmentId: row.id });
  assert.equal(new URL(download.download.url).hostname, "leilei-files-test.t3.storageapi.dev");
  assert.deepEqual(requests, []);
  row.status = "uploading";
  assert.equal((await service.completeUpload({ userId: row.userId, attachmentId: row.id })).status, "ready");
  assert.deepEqual(requests, ["HEAD"]);
});


test("an already issued inline download capability stays readable after migration", async () => {
  const bytes = Buffer.from("legacy attachment");
  const row = { content: null, filename: "legacy.txt", mimeType: "text/plain", status: "bound", sizeBytes: 17, sha256: "ab0abec23a813de8b92bea070d3375ce06a7260e47ec8167377ae2c15a21ba3a" };
  const db = { select() { return { from() { return { where() { return { async limit() { return [row]; } }; } }; } }; } };
  let corrupt = false;
  const legacy = new PostgresInlineAttachmentObjectStore(db as never, {
    signingSecret: "test", transferTtlSeconds: 600, maxFileBytes: 1024, maxTotalBytes: 2048,
    fallbackObjectStore: new S3PresignedAttachmentObjectStore(config),
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(new URL(String(input)).pathname, "/native-live/user/attachment");
      assert.equal(init!.method, "GET");
      return new Response(corrupt ? Buffer.from("wrong") : bytes);
    },
  });
  const token = legacy.createDownloadSlot({ objectKey: "native-live/user/attachment" }).url.split("/").at(-1)!;
  const result = await legacy.getTransfer({ token });
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.filename, "legacy.txt");
  assert.equal(result.mimeType, "text/plain");
  corrupt = true;
  await assert.rejects(legacy.getTransfer({ token }), (error: unknown) => error instanceof PostgresAttachmentTransferError && error.httpStatus === 502);
});
