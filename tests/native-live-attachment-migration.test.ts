import assert from "node:assert/strict";
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
      return true;
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
    skipped: 0,
    bytesMigrated: 17,
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
    skipped: 0,
    bytesMigrated: 0,
  });
});


test("migration repository selects stable inline rows and reports conditional clear misses", async () => {
  const { DrizzleNativeLiveInlineAttachmentMigrationRepository } = await import("../src/domains/bridge/native-live-attachment-migration.js");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const filters: { sql: string; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  const db = {
    select() { return { from() { return { where(condition: any) {
      filters.push(dialect.sqlToQuery(condition));
      return { orderBy() { return { async limit() { return []; } }; } };
    } }; } }; },
    update() { return { set() { return { where(condition: any) {
      filters.push(dialect.sqlToQuery(condition));
      return { async returning() { return []; } };
    } }; } }; },
  };
  const repo = new DrizzleNativeLiveInlineAttachmentMigrationRepository(db as never);
  await repo.listInlineBatch(8);
  assert.match(filters[0]!.sql, /"content" is not null/);
  assert.deepEqual(filters[0]!.params, ["ready", "bound"]);
  const row = migrationFixture().row;
  assert.equal(await repo.clearInlineContent(row as any), false);
  assert.match(filters[1]!.sql, /"content" is not null/);
  assert.ok(filters[1]!.params.includes("ready"));
  assert.ok(filters[1]!.params.includes("bound"));
});


import { createHash } from "node:crypto";
import { S3PresignedAttachmentObjectStore } from "../src/domains/bridge/native-live-attachment-storage.js";
import { migrateNativeLiveAttachmentInlineContentBatch } from "../src/domains/bridge/native-live-attachment-migration.js";

function migrationFixture(options: {
  size?: number; sha?: string; key?: string; mime?: string;
  existing?: "match" | "size" | "mime" | "sha";
  postUploadMismatch?: boolean; fail?: "head" | "put"; clear?: boolean;
} = {}) {
  const bytes = Buffer.from("legacy attachment");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const row = { id: "11111111-1111-4111-8111-111111111111", objectKey: options.key ?? "native-live/user/attachment", content: bytes as Buffer | null, mimeType: options.mime ?? "text/plain", sizeBytes: options.size ?? bytes.length, sha256: options.sha ?? hash };
  let object: Buffer | null = options.existing ? Buffer.from(bytes) : null;
  let puts = 0;
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(init!.method!);
    assert.equal(url.pathname, "/native-live/user/attachment");
    if (init!.method === "HEAD") {
      if (options.fail === "head") return new Response(null, { status: 503 });
      if (!object) return new Response(null, { status: 404 });
      return new Response(null, { status: 200, headers: {
        "content-length": String(options.existing === "size" || options.postUploadMismatch ? 1 : object.length),
        "content-type": options.existing === "mime" ? "image/png" : "text/plain",
        "x-amz-meta-sha256": options.existing === "sha" ? "0".repeat(64) : hash,
      } });
    }
    assert.equal(init!.method, "PUT");
    puts++;
    assert.equal(new Headers(init!.headers).get("content-type"), "text/plain");
    assert.equal(new Headers(init!.headers).get("x-amz-meta-sha256"), hash);
    if (options.fail === "put") return new Response(null, { status: 503 });
    object = Buffer.from(init!.body as Buffer);
    return new Response(null, { status: 200 });
  };
  const store = new S3PresignedAttachmentObjectStore({ bucket: "test", endpoint: "https://storage.example", accessKeyId: "test", secretAccessKey: "test", region: "auto", presignTtlSeconds: 600, maxFileBytes: 1024, maxPerTurn: 8, unboundTtlSeconds: 600 }, fetchImpl);
  const repo = {
    async listInlineBatch() { return row.content === null ? [] : [{ ...row, content: row.content }]; },
    async clearInlineContent() {
      if (options.clear === false || row.content === null) return false;
      row.content = null;
      return true;
    },
  };
  return { row, repo, store, fetchImpl, requests, get puts() { return puts; }, get object() { return object; } };
}

test("conditional clear miss is skipped and never counted as migrated", async () => {
  const f = migrationFixture({ existing: "match", clear: false });
  const result = await migrateNativeLiveAttachmentInlineContentBatch(f.repo, f.store, 8, f.fetchImpl);
  assert.equal(result.migrated, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.bytesMigrated, 0);
  assert.notEqual(f.row.content, null);
});

test("verified migration uses the existing key and preserves exact bytes, then becomes idle", async () => {
  const f = migrationFixture();
  const result = await migrateNativeLiveAttachmentInlineContentBatch(f.repo, f.store, 8, f.fetchImpl);
  assert.equal(result.migrated, 1);
  assert.equal(result.bytesMigrated, 17);
  assert.deepEqual(f.object, Buffer.from("legacy attachment"));
  assert.equal(f.row.content, null);
  assert.deepEqual(f.requests, ["HEAD", "PUT", "HEAD"]);
  assert.equal((await migrateNativeLiveAttachmentInlineContentBatch(f.repo, f.store, 8, f.fetchImpl)).examined, 0);
  assert.equal(f.puts, 1);
});

for (const [name, options] of [
  ["checksum mismatch", { sha: "0".repeat(64) }],
  ["size mismatch", { size: 1 }],
  ["invalid key", { key: "" }],
  ["missing MIME", { mime: "" }],
  ["existing size mismatch", { existing: "size" }],
  ["existing MIME mismatch", { existing: "mime" }],
  ["existing checksum mismatch", { existing: "sha" }],
  ["post-upload HEAD mismatch", { postUploadMismatch: true }],
  ["Bucket HEAD failure", { fail: "head" }],
  ["Bucket PUT failure", { fail: "put" }],
] as const) {
  test(`migration preserves inline bytes on ${name}`, async () => {
    const f = migrationFixture(options);
    const result = await migrateNativeLiveAttachmentInlineContentBatch(f.repo, f.store, 8, f.fetchImpl);
    assert.equal(result.migrated, 0);
    assert.equal(result.failed, 1);
    assert.deepEqual(f.row.content, Buffer.from("legacy attachment"));
    if (!("postUploadMismatch" in options) && !("fail" in options)) assert.equal(f.puts, 0);
    if ("sha" in options || "size" in options || "key" in options || "mime" in options) assert.deepEqual(f.requests, []);
  });
}

test("matching existing Bucket object clears PG without uploading again", async () => {
  const f = migrationFixture({ existing: "match" });
  const result = await migrateNativeLiveAttachmentInlineContentBatch(f.repo, f.store, 8, f.fetchImpl);
  assert.equal(result.migrated, 1);
  assert.equal(f.row.content, null);
  assert.equal(f.puts, 0);
});


test("migration rechecks under the object lock and skips rows already removed", async () => {
  const f = migrationFixture();
  const repo = { ...f.repo, async withLockedRecord(_row: unknown, operation: (row: null, repo: typeof f.repo) => Promise<boolean>) { return operation(null, f.repo); } };
  const result = await migrateNativeLiveAttachmentInlineContentBatch(repo, f.store, 8, f.fetchImpl);
  assert.equal(result.migrated, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(f.requests, []);
});
