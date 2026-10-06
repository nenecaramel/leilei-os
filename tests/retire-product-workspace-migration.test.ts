import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postgres from "postgres";
const enabled = process.env.RUN_RETIRE_WORKSPACE_DATABASE_TEST === "1";

test("retirement migration preserves transcripts/status/paths and refuses namespace collisions", { skip: !enabled }, async () => {
  const url = process.env.DATABASE_URL!;
  assert.match(new URL(url).pathname, /test|scratch|ephemeral/);
  const db = postgres(url, { max: 1 });
  const migration = readFileSync(new URL("../drizzle/0099_retire_product_workspace.sql", import.meta.url), "utf8");
  const old = `
    CREATE TABLE native_live_provider_session_entries (id bigserial PRIMARY KEY, user_id uuid, workspace_id uuid NOT NULL, provider_session_id text, subpath text, append_batch_id uuid, append_ordinal integer, entry jsonb, created_at timestamptz);
    CREATE TABLE native_live_provider_session_store_status (user_id uuid, workspace_id uuid NOT NULL, provider_session_id text, state text, updated_at timestamptz, CONSTRAINT native_live_provider_session_store_status_pk PRIMARY KEY (user_id, workspace_id, provider_session_id));
    CREATE TABLE conversation_provider_session_checkpoints (workspace_id uuid, effective_workspace_root text);
    CREATE TABLE native_live_turn_preparations (workspace_id uuid, expected_workspace_root text);
    CREATE TABLE native_live_provider_session_cleanups (workspace_id uuid, effective_workspace_root text);
    CREATE TABLE native_live_conversation_provider_bootstraps (workspace_id uuid, effective_workspace_root text);
    CREATE TABLE native_live_manual_compactions (workspace_id uuid, effective_workspace_root text); CREATE TABLE workspaces (id uuid); CREATE TABLE workspace_resources (id uuid); CREATE TABLE workspace_conversations (id uuid);
    CREATE TABLE product_create_idempotency (operation text, resource_type text);
  `;
  const user = "11111111-1111-4111-8111-111111111111", wa = "22222222-2222-4222-8222-222222222222", wb = "33333333-3333-4333-8333-333333333333";
  try {
    for (const collision of ["none", "split", "entries", "status", "other-user"]) {
      const schema = "retire_test_" + crypto.randomUUID().replaceAll("-", "");
      await db.unsafe(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};`);
      try {
        await db.unsafe(old);
        await db`INSERT INTO native_live_provider_session_entries (user_id, workspace_id, provider_session_id, subpath, append_batch_id, append_ordinal, entry, created_at) VALUES (${user}, ${wa}, 'session-a', '', ${wa}, 0, '{"type":"user","text":"keep"}', now())`;
        await db`INSERT INTO native_live_provider_session_store_status VALUES (${user}, ${collision === "split" ? wb : wa}, 'session-a', 'complete', now())`;
        for (const table of ["conversation_provider_session_checkpoints", "native_live_provider_session_cleanups", "native_live_conversation_provider_bootstraps", "native_live_manual_compactions"]) await db.unsafe(`INSERT INTO ${table} VALUES ('${wa}', '/Volumes/historical/project')`);
        await db.unsafe(`INSERT INTO native_live_turn_preparations VALUES ('${wa}', '/Volumes/historical/project')`);
        if (collision === "entries") await db`INSERT INTO native_live_provider_session_entries (user_id, workspace_id, provider_session_id, subpath, append_batch_id, append_ordinal, entry) VALUES (${user}, ${wb}, 'session-a', 'agent/tool', ${wb}, 0, '{"type":"assistant"}')`;
        if (collision === "status") await db`INSERT INTO native_live_provider_session_store_status VALUES (${user}, ${wb}, 'session-a', 'incomplete', now())`;
        if (collision === "other-user") await db`INSERT INTO native_live_provider_session_store_status VALUES (${wb}, ${wb}, 'session-a', 'incomplete', now())`;
        const apply = () => db.begin(async tx => { for (const part of migration.split('--> statement-breakpoint')) if (part.trim()) await tx.unsafe(part); });
        if (["split", "entries", "status"].includes(collision)) {
          await assert.rejects(apply(), /SESSION_STORE_NAMESPACE_COLLISION/);
          assert.equal((await db`SELECT workspace_id FROM native_live_provider_session_entries`)[0]!.workspace_id, wa);
          assert.ok((await db`SELECT to_regclass('workspaces') AS name`)[0]!.name);
        } else {
          await apply();
          assert.deepEqual((await db`SELECT entry FROM native_live_provider_session_entries`)[0]!.entry, { type: "user", text: "keep" });
          assert.equal((await db`SELECT state FROM native_live_provider_session_store_status`)[0]!.state, "complete");
          assert.equal((await db`SELECT effective_working_directory FROM conversation_provider_session_checkpoints`)[0]!.effective_working_directory, "/Volumes/historical/project");
          assert.equal((await db`SELECT expected_working_directory FROM native_live_turn_preparations`)[0]!.expected_working_directory, "/Volumes/historical/project");
          for (const table of ["native_live_provider_session_cleanups", "native_live_conversation_provider_bootstraps", "native_live_manual_compactions"]) {
            assert.equal((await db.unsafe(`SELECT effective_working_directory FROM ${table}`))[0]!.effective_working_directory, "/Volumes/historical/project");
          }
          assert.equal((await db`SELECT count(*)::int AS n FROM native_live_provider_session_store_status`)[0]!.n, collision === "other-user" ? 2 : 1);
          const columns = await db`SELECT column_name FROM information_schema.columns WHERE table_schema = ${schema}`;
          assert.ok(columns.every(row => !/workspace/.test(row.column_name)));
          assert.equal((await db`SELECT to_regclass('workspaces') AS name`)[0]!.name, null);
        }
      } finally { await db.unsafe(`SET search_path TO public; DROP SCHEMA ${schema} CASCADE`); }
    }
  } finally { await db.end(); }
});
