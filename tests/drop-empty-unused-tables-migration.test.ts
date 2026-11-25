import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getTableName, is, Table } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";

// Tables are listed in name order, which is also the order of the SQLSTATEs.
const DROPS = [
  {
    migration: "0114_drop_empty_unused_tables",
    state: "LE00",
    tables: [
      "conversation_deleted_branches",
      "conversation_exclusions",
      "conversation_favorite_messages",
      "conversation_import_blobs",
      "conversation_message_versions",
      "native_live_concerns",
      "runtime_effect_message_deliveries",
      "runtime_mind_retirement_receipts",
    ],
  },
  {
    migration: "0115_drop_empty_retired_queue_tables",
    state: "LE01",
    tables: [
      "conversation_favorites",
      "native_live_background_model_jobs",
      "runtime_effects",
      "runtime_proactivity_wakes",
    ],
  },
];

test("the schema no longer declares the unused tables", () => {
  const declared = new Set(Object.values(schema).filter(value => is(value, Table)).map(value => getTableName(value as Table)));
  assert.ok(declared.has("conversations"));
  assert.deepEqual(DROPS.flatMap(drop => drop.tables).filter(table => declared.has(table)), []);
});

for (const { migration, state, tables: TABLES } of DROPS) test(`${migration} drops its tables only while every one of them is empty`,
  { skip: process.env.RUN_DROP_UNUSED_TABLES_MIGRATION_TEST !== "1" }, async () => {
    const url = process.env.DATABASE_URL!;
    assert.match(new URL(url).pathname, /test|scratch|ephemeral/);
    const db = postgres(url, { max: 1 });
    const rollback = new Error("rollback fixture");
    const sql = readFileSync(new URL(`../drizzle/${migration}.sql`, import.meta.url), "utf8");
    // The migration log prints only the SQLSTATE, so each table has its own.
    const refusal = (table: string) => `${state}${TABLES.indexOf(table) + 1}`;
    const existing = async (tx: postgres.TransactionSql | typeof db) => (await tx`
      SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename IN ${db(TABLES)} ORDER BY tablename`).map(row => row.tablename);
    try {
      assert.deepEqual(await existing(db), [], "the test database is already migrated");
      // Stand-ins for the dropped tables; nothing outside the transaction sees them.
      const run = (filled: string | null, check: (tx: postgres.TransactionSql, apply: () => Promise<void>) => Promise<void>) =>
        db.begin(async tx => {
          for (const table of TABLES) await tx.unsafe(`CREATE TABLE public.${table} (id integer)`);
          if (filled) await tx.unsafe(`INSERT INTO public.${filled} VALUES (1)`);
          await check(tx, async () => {
            for (const part of sql.split("--> statement-breakpoint")) if (part.trim()) await tx.unsafe(part);
          });
          throw rollback;
        }).catch(error => { if (error !== rollback) throw error; });

      await run(null, async (tx, apply) => {
        const before = await tx`SELECT count(*)::int AS n FROM pg_catalog.pg_tables WHERE schemaname = 'public'`;
        await apply();
        assert.deepEqual(await existing(tx), []);
        const after = await tx`SELECT count(*)::int AS n FROM pg_catalog.pg_tables WHERE schemaname = 'public'`;
        assert.equal(before[0]!.n - after[0]!.n, TABLES.length, "no other table is dropped");
      });
      for (const table of TABLES) {
        await run(table, async (tx, apply) => {
          await assert.rejects(
            tx.savepoint(async () => { await apply(); }),
            (error: unknown) => (error as { code?: string }).code === refusal(table),
            table,
          );
          assert.deepEqual(await existing(tx), TABLES, `${table}: nothing is dropped`);
          assert.equal((await tx.unsafe(`SELECT count(*)::int AS n FROM public.${table}`))[0]!.n, 1);
        });
      }
      assert.deepEqual(await existing(db), []);
    } finally { await db.end(); }
  });
