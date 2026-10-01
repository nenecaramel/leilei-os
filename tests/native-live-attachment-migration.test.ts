import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("attachment bucket migration uploads, verifies, then clears inline bytes", async () => {
  const migrationModule = await import(
    "../src/domains/bridge/native-live-attachment-migration.js"
  ).catch(() => null);

  assert.ok(migrationModule);
  assert.equal(
    typeof migrationModule.migrateNativeLiveAttachmentInlineContentBatch,
    "function",
  );

  const content = Buffer.from("legacy attachment");
  const sha256 =
    "ab0abec23a813de8b92bea070d3375ce06a7260e47ec8167377ae2c15a21ba3a";
  const records = [{
    id: "11111111-1111-4111-8111-111111111111",
    objectKey: "native-live/user/attachment",
    content,
    mimeType: "text/plain",
    sizeBytes: content.byteLength,
    sha256,
  }];
  const cleared: string[] = [];
  const repository = {
    async listInlineBatch() {
      return records;
    },
    async clearInlineContent(input: { id: string }) {
      cleared.push(input.id);
    },
  };

  let uploaded: Buffer | null = null;
  let headCalls = 0;
  const objectStore = {
    createUploadSlot() {
      return {
        url: "https://bucket.example/object",
        method: "PUT" as const,
        headers: {
          "content-type": "text/plain",
          "x-amz-meta-sha256": sha256,
        },
        expiresAt: "2026-10-01T12:00:00.000Z",
      };
    },
    createDownloadSlot() {
      throw new Error("unused");
    },
    async headObject() {
      headCalls += 1;
      if (headCalls === 1) return null;
      return {
        sizeBytes: content.byteLength,
        mimeType: "text/plain",
        sha256,
      };
    },
    async deleteObject() {},
  };

  const result =
    await migrationModule.migrateNativeLiveAttachmentInlineContentBatch(
      repository,
      objectStore,
      8,
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        uploaded = Buffer.from(init?.body as Buffer);
        return new Response(null, { status: 200 });
      },
    );

  assert.deepEqual(uploaded, content);
  assert.deepEqual(cleared, [records[0]!.id]);
  assert.deepEqual(result, {
    examined: 1,
    migrated: 1,
    failed: 0,
  });
});

test("attachment bucket migration never clears inline bytes before verification", async () => {
  const migrationModule = await import(
    "../src/domains/bridge/native-live-attachment-migration.js"
  ).catch(() => null);
  assert.ok(migrationModule);

  const content = Buffer.from("legacy attachment");
  const repository = {
    async listInlineBatch() {
      return [{
        id: "11111111-1111-4111-8111-111111111111",
        objectKey: "native-live/user/attachment",
        content,
        mimeType: "text/plain",
        sizeBytes: content.byteLength,
        sha256:
          "ab0abec23a813de8b92bea070d3375ce06a7260e47ec8167377ae2c15a21ba3a",
      }];
    },
    async clearInlineContent() {
      throw new Error("must not clear");
    },
  };
  const objectStore = {
    createUploadSlot() {
      return {
        url: "https://bucket.example/object",
        method: "PUT" as const,
        headers: {},
        expiresAt: "2026-10-01T12:00:00.000Z",
      };
    },
    createDownloadSlot() {
      throw new Error("unused");
    },
    async headObject() {
      return {
        sizeBytes: 1,
        mimeType: "text/plain",
        sha256: "0".repeat(64),
      };
    },
    async deleteObject() {},
  };

  const result =
    await migrationModule.migrateNativeLiveAttachmentInlineContentBatch(
      repository,
      objectStore,
      8,
      async () => new Response(null, { status: 200 }),
    );

  assert.deepEqual(result, {
    examined: 1,
    migrated: 0,
    failed: 1,
  });
});


test("attachment bucket migration only selects stable ready or bound rows", () => {
  const source = fs.readFileSync(
    "src/domains/bridge/native-live-attachment-migration.ts",
    "utf8",
  );

  assert.match(
    source,
    /inArray\(\s*nativeLiveChatAttachments\.status,\s*\["ready", "bound"\]\s*\)/,
  );
});
