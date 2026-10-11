import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { providerSessionUnreferenced } from "../src/domains/bridge/provider-session/native-live-provider-session-references.js";
import { DrizzleNativeLiveProviderSessionStoreRepository } from "../src/domains/bridge/provider-session/native-live-provider-session-store.js";
import { DrizzleNativeLiveProviderSessionCleanupRepository } from "../src/domains/bridge/provider-session/native-live-provider-session-cleanup.js";

const enabled = process.env.RUN_NATIVE_SESSION_PRESERVATION_DATABASE_TEST === "1";
const user = "00000000-0000-4000-8000-000000000001";
const otherUser = "00000000-0000-4000-8000-000000000002";
const session = "00000000-0000-4000-8000-000000000003";
const conversation = "00000000-0000-4000-8000-000000000004";

async function fixture(run: (db: ReturnType<typeof createDatabase>["db"]) => Promise<void>) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/leileios_native_session_test");
  assert.notEqual(process.env.NODE_ENV, "production");
  const schema = "native_preservation_" + randomUUID().replaceAll("-", "");
  const client = postgres(url.toString(), { max: 2, prepare: false, ssl: false, connection: { search_path: schema } });
  const database = createDatabase(url.toString(), { createClient: () => client });
  try {
    await client.unsafe(`CREATE SCHEMA ${schema}`);
    await client.unsafe(`SET search_path TO ${schema}`);
    await client.unsafe(`
      CREATE TABLE native_live_provider_session_store_status (user_id uuid, provider_session_id text, state text, preserve_external_session boolean NOT NULL DEFAULT false, updated_at timestamptz DEFAULT now(), PRIMARY KEY(user_id,provider_session_id));
      CREATE TABLE native_live_provider_session_entries (user_id uuid, provider_session_id text, subpath text);
      CREATE TABLE conversation_provider_session_checkpoints (user_id uuid, provider text, provider_session_id text, conversation_id uuid, canonical_message_id uuid);
      CREATE TABLE native_live_conversation_provider_bootstraps (user_id uuid, provider text, source_provider_session_id text, consumed_at timestamptz, conversation_id uuid);
      CREATE TABLE native_live_turn_preparations (user_id uuid, status text, parent_provider_session_id text, provider_session_id text, conversation_id uuid);
      CREATE TABLE native_live_manual_compactions (user_id uuid, provider_session_id text, status text, conversation_id uuid);
      CREATE TABLE native_live_provider_session_cleanups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, provider text DEFAULT 'claude_code', provider_session_id text, status text DEFAULT 'pending', attempt integer DEFAULT 0, reserved_by uuid, reserved_at timestamptz, reservation_expires_at timestamptz, effective_working_directory text, last_error_code text, completed_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE native_live_runtime_listener_leases (user_id uuid, dispatch_target text, listener_instance_id uuid, lease_expires_at timestamptz, updated_at timestamptz DEFAULT now());
    `);
    await run(database.db);
  } finally {
    await client.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await database.close();
  }
}

async function canClean(db: ReturnType<typeof createDatabase>["db"], excludeConversationId?: string) {
  const rows = await db.execute<{ allowed: boolean }>(sql`SELECT ${providerSessionUnreferenced({ userId: user, providerSessionId: session, excludeConversationId })} AS allowed`);
  return rows[0]!.allowed;
}

test("external native ownership survives deletion of the last projection/checkpoint", { skip: !enabled }, async () => fixture(async db => {
  await db.execute(sql`INSERT INTO native_live_provider_session_store_status (user_id,provider_session_id,state,preserve_external_session) VALUES (${user}::uuid,${session},'complete',true)`);
  await db.execute(sql`INSERT INTO conversation_provider_session_checkpoints VALUES (${user}::uuid,'claude_code',${session},${conversation}::uuid,${randomUUID()}::uuid)`);
  assert.equal(await canClean(db, conversation), false);
  await db.execute(sql`DELETE FROM conversation_provider_session_checkpoints`);
  assert.equal(await canClean(db), false);
}));

test("preservation is sticky through status updates and prevents destructive SessionStore deletion", { skip: !enabled }, async () => fixture(async db => {
  const repository = new DrizzleNativeLiveProviderSessionStoreRepository(db);
  await repository.setStatus({ userId: user, sessionId: session, state: "complete" });
  await db.execute(sql`INSERT INTO native_live_provider_session_entries VALUES (${user}::uuid,${session},'')`);
  await db.execute(sql`INSERT INTO native_live_provider_session_cleanups (user_id,provider_session_id,status) VALUES (${user}::uuid,${session},'pending')`);
  await repository.preserveExternalSession({ userId: user, sessionId: session });
  assert.equal(await repository.getStatus({ userId: user, sessionId: session }), "complete");
  await repository.setStatus({ userId: user, sessionId: session, state: "incomplete" });
  assert.equal(await canClean(db), false);
  const jobs = await db.execute<{ status: string; last_error_code: string }>(sql`SELECT status,last_error_code FROM native_live_provider_session_cleanups`);
  assert.equal(jobs[0]!.status, "failed");
  assert.equal(jobs[0]!.last_error_code, "EXTERNAL_SESSION_PRESERVED");
  await assert.rejects(() => repository.delete({ userId: user, key: { sessionId: session } }), (error: any) => error.code === "EXTERNAL_SESSION_PRESERVED");
  await assert.rejects(() => repository.delete({ userId: user, key: { sessionId: session, subpath: "subagents/example" } }), (error: any) => error.code === "EXTERNAL_SESSION_PRESERVED");
  const entries = await db.execute<{ count: number }>(sql`SELECT count(*)::integer AS count FROM native_live_provider_session_entries`);
  assert.equal(entries[0]!.count, 1);
}));

test("ownership lock closes the empty-marker window before cleanup can reserve a session", { skip: !enabled }, async () => fixture(async db => {
  const { providerSessionOwnershipLock } = await import("../src/domains/bridge/provider-session/native-live-provider-session-references.js");
  assert.equal(typeof providerSessionOwnershipLock, "function");
  let signalLocked!: () => void;
  let release!: () => void;
  const locked = new Promise<void>(resolve => { signalLocked = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const owner = db.transaction(async tx => {
    await tx.execute(sql`SELECT ${providerSessionOwnershipLock({ providerSessionId: session, wait: true })}`);
    signalLocked();
    await released;
  });
  try {
    await Promise.race([locked, owner.then(() => { throw new Error("Owner exited before acquiring lock"); })]);
    const competing = await db.execute<{ acquired: boolean }>(sql`SELECT ${providerSessionOwnershipLock({ providerSessionId: session, wait: false })} AS acquired`);
    assert.equal(competing[0]!.acquired, false);
  } finally { release(); await owner; }
  const available = await db.execute<{ acquired: boolean }>(sql`SELECT ${providerSessionOwnershipLock({ providerSessionId: session, wait: false })} AS acquired`);
  assert.equal(available[0]!.acquired, true);
}));

test("a reserved destructive cleanup blocks import preservation instead of racing its executor", { skip: !enabled }, async () => fixture(async db => {
  const repository = new DrizzleNativeLiveProviderSessionStoreRepository(db);
  await db.execute(sql`INSERT INTO native_live_provider_session_cleanups (user_id,provider_session_id,status) VALUES (${user}::uuid,${session},'reserved')`);
  await assert.rejects(() => repository.preserveExternalSession({ userId: user, sessionId: session }), (error: any) => error.code === "CLEANUP_IN_PROGRESS");
  const markers = await db.execute<{ count: number }>(sql`SELECT count(*)::integer AS count FROM native_live_provider_session_store_status`);
  assert.equal(markers[0]!.count, 0);
}));

test("a shared native UUID is protected across aliases while cached tenant data stays isolated", { skip: !enabled }, async () => fixture(async db => {
  const repository = new DrizzleNativeLiveProviderSessionStoreRepository(db);
  assert.equal(await canClean(db), true);
  await db.execute(sql`INSERT INTO native_live_provider_session_store_status (user_id,provider_session_id,state,preserve_external_session) VALUES (${otherUser}::uuid,${session},'complete',true)`);
  await repository.setStatus({ userId: user, sessionId: session, state: "complete" });
  assert.equal(await canClean(db), false);
  await repository.delete({ userId: user, key: { sessionId: session } });
  assert.equal(await repository.getStatus({ userId: user, sessionId: session }), null);
  assert.equal(await repository.getStatus({ userId: otherUser, sessionId: session }), "complete");
}));

test("preservation migration keeps existing session state and defaults legacy sessions to unmarked", { skip: !enabled }, async () => fixture(async db => {
  await db.execute(sql`ALTER TABLE native_live_provider_session_store_status DROP COLUMN preserve_external_session`);
  await db.execute(sql`INSERT INTO native_live_provider_session_store_status (user_id,provider_session_id,state) VALUES (${user}::uuid,${session},'complete')`);
  const migration = await readFile(new URL("../drizzle/0107_native_session_preservation.sql", import.meta.url), "utf8");
  await db.execute(sql.raw(migration));
  const rows = await db.execute<{ state: string; preserve_external_session: boolean }>(sql`SELECT state,preserve_external_session FROM native_live_provider_session_store_status`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.state, "complete");
  assert.equal(rows[0]!.preserve_external_session, false);
}));

test("cleanup reservation cannot pass an in-flight preservation even before its marker exists", { skip: !enabled }, async () => fixture(async db => {
  const { providerSessionOwnershipLock } = await import("../src/domains/bridge/provider-session/native-live-provider-session-references.js");
  const listener = randomUUID();
  await db.execute(sql`INSERT INTO native_live_runtime_listener_leases (user_id,dispatch_target,listener_instance_id,lease_expires_at) VALUES (${user}::uuid,'claude_code',${listener}::uuid,now()+interval '1 hour')`);
  await db.execute(sql`INSERT INTO native_live_provider_session_cleanups (user_id,provider_session_id) VALUES (${user}::uuid,${session})`);
  const cleanup = new DrizzleNativeLiveProviderSessionCleanupRepository(db);
  let signalLocked!: () => void;
  let release!: () => void;
  const locked = new Promise<void>(resolve => { signalLocked = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const owner = db.transaction(async tx => {
    await tx.execute(sql`SELECT ${providerSessionOwnershipLock({ providerSessionId: session, wait: true })}`);
    signalLocked();
    await released;
    await tx.execute(sql`INSERT INTO native_live_provider_session_store_status (user_id,provider_session_id,state,preserve_external_session) VALUES (${user}::uuid,${session},'incomplete',true)`);
  });
  try {
    await Promise.race([locked, owner.then(() => { throw new Error("Owner exited before acquiring lock"); })]);
    assert.equal(await cleanup.reserveNext({ userId: user, listenerInstanceId: listener }), null);
  } finally { release(); await owner; }
  assert.equal(await cleanup.reserveNext({ userId: user, listenerInstanceId: listener }), null);
}));
