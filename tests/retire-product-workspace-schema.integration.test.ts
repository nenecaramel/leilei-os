import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import postgres from "postgres";

const enabled = process.env.RUN_RETIRE_WORKSPACE_DATABASE_TEST === "1";
test("fresh Drizzle schema and complete migration ledger agree on retired surfaces", { skip: !enabled }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /test|scratch|ephemeral/);
  const admin = postgres(url.href, { max: 1 });
  const names = ["retire_schema_test_", "retire_ledger_test_"].map(prefix => prefix + crypto.randomUUID().replaceAll("-", ""));
  const clients: ReturnType<typeof postgres>[] = [];
  try {
    for (const name of names) {
      await admin.unsafe(`CREATE DATABASE ${name}`);
      const target = new URL(url); target.pathname = "/" + name;
      clients.push(postgres(target.href, { max: 1 }));
    }
    const schemaSQL = execFileSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "export", "--dialect", "postgresql", "--schema", "./src/database/schema.ts"], { encoding: "utf8", maxBuffer: 10_000_000 });
    // drizzle-kit export emits FKs before supporting unique indexes. Build
    // the same schema with indexes first, then apply every exported FK.
    const statements = schemaSQL.split(/;\n/).filter(part => part.trim());
    const foreignKeys = statements.filter(part => /ALTER TABLE[\s\S]*FOREIGN KEY/.test(part));
    await clients[0]!.unsafe(statements.filter(part => !foreignKeys.includes(part)).join(";\n") + ";");
    await clients[0]!.unsafe(foreignKeys.join(";\n") + ";");
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    for (const entry of journal.entries) {
      const sql = readFileSync(`drizzle/${entry.tag}.sql`, "utf8");
      await clients[1]!.begin(async tx => {
        for (const part of sql.split("--> statement-breakpoint")) if (part.trim()) await tx.unsafe(part);
      });
    }
    const tables = ["native_live_provider_session_entries", "native_live_provider_session_store_status", "conversation_provider_session_checkpoints", "native_live_turn_preparations", "native_live_provider_session_cleanups", "native_live_conversation_provider_bootstraps", "native_live_manual_compactions", "native_live_external_session_requests"];
    const snapshots = [];
    for (const db of clients) {
      const columns = await db`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ${db(tables)} ORDER BY table_name, column_name`;
      assert.ok(columns.every(row => !/workspace/.test(row.column_name)));
      for (const table of ["workspaces", "workspace_resources", "workspace_conversations"]) assert.equal((await db`SELECT to_regclass(${table}) AS name`)[0]!.name, null);
      const keys = await db`SELECT t.relname AS table_name, i.indisunique, i.indisprimary, pg_get_expr(i.indpred, i.indrelid) AS predicate, ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum ORDER BY k.ord) AS columns FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid WHERE t.relname IN ${db(tables)} ORDER BY t.relname, i.indisprimary, i.indisunique, columns`;
      const constraints = await db`SELECT t.relname AS table_name, c.contype, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname IN ${db(tables)} ORDER BY t.relname, c.contype, definition`;
      snapshots.push({columns: Array.from(columns), keys: Array.from(keys), constraints: Array.from(constraints)});
    }
    assert.deepEqual(snapshots[1], snapshots[0]);
  } finally {
    for (const db of clients) await db.end();
    for (const name of names) await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  }
});
