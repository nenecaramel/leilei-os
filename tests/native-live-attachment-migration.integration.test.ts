import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createDatabase } from "../src/database/client.js";
import { DrizzleNativeLiveInlineAttachmentMigrationRepository, migrateNativeLiveAttachmentInlineContentBatch } from "../src/domains/bridge/attachment/native-live-attachment-migration.js";
import { deleteExpiredNativeLiveAttachmentsBatch } from "../src/domains/bridge/attachment/native-live-attachment-service.js";
import { PostgresInlineAttachmentObjectStore } from "../src/domains/bridge/attachment/native-live-attachment-postgres-storage.js";
import { S3PresignedAttachmentObjectStore } from "../src/domains/bridge/attachment/native-live-attachment-storage.js";

test("isolated Postgres: concurrent migration and retention preserve byte ownership", {
  skip: process.env.RUN_NATIVE_LIVE_ATTACHMENT_DATABASE_TEST !== "1",
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  assert.match(url.pathname, /test|regression|scratch/);
  const schema = "attachment_" + randomUUID().replaceAll("-", "");
  const admin = postgres(url.toString(), { ssl: false });
  const resource = createDatabase(url.toString(), {
    ssl: false,
    createClient: (value, max) => postgres(value, { max, ssl: false, prepare: false, connection: { search_path: schema } }),
  });
  const sql = postgres(url.toString(), { ssl: false, connection: { search_path: schema } });
  const objects = new Map<string, Buffer>();
  const content = Buffer.from("legacy attachment");
  const sha = createHash("sha256").update(content).digest("hex");
  let puts = 0;
  let releasePut: (() => void) | undefined;
  let startedPut: (() => void) | undefined;
  let fetchImpl!: typeof fetch;
  const store = new S3PresignedAttachmentObjectStore({ bucket: "test", endpoint: "https://bucket.example", accessKeyId: "test", secretAccessKey: "test", region: "auto", presignTtlSeconds: 600, maxFileBytes: 1024, maxPerTurn: 8, unboundTtlSeconds: 600 }, fetchImpl = async (input, init) => {
    const key = new URL(String(input)).pathname.slice(1);
    if (init!.method === "HEAD") {
      const bytes = objects.get(key);
      return bytes ? new Response(null, { status: 200, headers: { "content-length": String(bytes.length), "content-type": "text/plain", "x-amz-meta-sha256": sha } }) : new Response(null, { status: 404 });
    }
    if (init!.method === "PUT") {
      puts++;
      if (startedPut) { startedPut(); await new Promise<void>((resolve) => { releasePut = resolve; }); }
      objects.set(key, Buffer.from(init!.body as Uint8Array));
      return new Response(null, { status: 200 });
    }
    assert.equal(init!.method, "DELETE");
    objects.delete(key);
    return new Response(null, { status: 204 });
  });
  const repo = new DrizzleNativeLiveInlineAttachmentMigrationRepository(resource.db);
  const legacy = new PostgresInlineAttachmentObjectStore(resource.db, { signingSecret: "test", transferTtlSeconds: 600, maxFileBytes: 1024, maxTotalBytes: 2048 });
  async function insert(status = "ready", expired = false) {
    const id = randomUUID();
    const key = `native-live/user/${id}`;
    await sql`INSERT INTO native_live_chat_attachments (id,user_id,object_key,content,filename,mime_type,size_bytes,sha256,kind,status,expires_at) VALUES (${id},${randomUUID()},${key},${content},'legacy.txt','text/plain',17,${sha},'file',${status},${expired ? new Date(0) : new Date(Date.now() + 600000)})`;
    return { id, key };
  }
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`;
    await sql`CREATE TABLE native_live_chat_attachments (id uuid PRIMARY KEY,user_id uuid NOT NULL,object_key text NOT NULL UNIQUE,content bytea,filename text NOT NULL,mime_type text NOT NULL,size_bytes bigint NOT NULL,sha256 varchar(64) NOT NULL,kind varchar(16) NOT NULL,status varchar(16) NOT NULL,bound_message_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),ready_at timestamptz,bound_at timestamptz,failed_at timestamptz,expires_at timestamptz NOT NULL)`;
    await sql`CREATE TABLE conversation_messages (id uuid,user_id uuid)`;
    const uploading = await insert("uploading");
    const stable = await insert();
    assert.equal((await repo.listInlineBatch(8)).length, 1);
    const results = await Promise.all([migrateNativeLiveAttachmentInlineContentBatch(repo, store, 8, fetchImpl), migrateNativeLiveAttachmentInlineContentBatch(repo, store, 8, fetchImpl)]);
    assert.equal(results.reduce((sum, r) => sum + r.migrated, 0), 1);
    assert.equal(results.reduce((sum, r) => sum + r.failed, 0), 0);
    assert.equal(puts, 1);
    assert.deepEqual(objects.get(stable.key), content);
    assert.equal((await sql`SELECT content FROM native_live_chat_attachments WHERE id=${stable.id}`)[0]!.content, null);
    assert.deepEqual((await sql`SELECT content FROM native_live_chat_attachments WHERE id=${uploading.id}`)[0]!.content, content);
    const inline = await insert("ready", true);
    objects.set(inline.key, content); // A prior upload whose DB clear failed.
    assert.equal(await deleteExpiredNativeLiveAttachmentsBatch(resource.db, store, new Date(), 10, legacy), 1);
    assert.equal(objects.has(inline.key), false);
    assert.equal((await sql`SELECT id FROM native_live_chat_attachments WHERE id=${inline.id}`).length, 0);
    await sql`UPDATE native_live_chat_attachments SET expires_at=${new Date(0)} WHERE id=${stable.id}`;
    assert.equal(await deleteExpiredNativeLiveAttachmentsBatch(resource.db, store, new Date(), 10, legacy), 1);
    assert.equal(objects.has(stable.key), false);
    const racing = await insert("ready", true);
    const putStarted = new Promise<void>((resolve) => { startedPut = resolve; });
    const migration = migrateNativeLiveAttachmentInlineContentBatch(repo, store, 8, fetchImpl);
    await putStarted;
    const retention = deleteExpiredNativeLiveAttachmentsBatch(resource.db, store, new Date(), 10, legacy);
    releasePut!();
    assert.equal((await migration).migrated, 1);
    assert.equal(await retention, 1);
    assert.equal(objects.has(racing.key), false);
    assert.equal((await sql`SELECT id FROM native_live_chat_attachments WHERE id=${racing.id}`).length, 0);
  } finally {
    releasePut?.();
    await resource.close();
    await sql.end();
    await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
    await admin.end();
  }
});
