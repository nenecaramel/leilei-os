import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import postgres from "postgres";
import { readSchemaSource } from "./helpers/schema-source.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = `${root}/drizzle/0020_weighted_galaxy_expand.sql`;
const runIntegration = process.env.RUN_UNIVERSE_WEIGHTED_EXPAND_DATABASE_TEST === "1"
  && Boolean(process.env.DATABASE_URL)
  && ["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname);

function migrationStatements(): string[] {
  return readFileSync(migrationPath, "utf8")
    .split(/\n?--> statement-breakpoint\s*/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyExpand(client: postgres.Sql<{}>): Promise<void> {
  const statements = migrationStatements();
  assert.equal(statements.length, 1, "0020 must execute as one self-atomic operation");
  await client.unsafe(statements[0]!);
}

async function seedOwner(
  client: postgres.Sql<{}>,
  callback: (transaction: postgres.TransactionSql<{}>, userId: string) => Promise<void>,
): Promise<string> {
  const userId = randomUUID();
  await client.begin(async (transaction) => {
    await insertUser(transaction, userId);
    await callback(transaction, userId);
  });
  return userId;
}

async function insertUser(transaction: postgres.TransactionSql<{}>, userId: string): Promise<void> {
  const now = new Date("2026-08-15T00:00:00.000Z");
  await transaction`
    insert into users (id, email, display_name, status, created_at, updated_at)
    values (${userId}, ${`weighted-expand-${userId}@example.invalid`}, 'Expand test', 'active', ${now}, ${now})
  `;
}

async function cleanupOwner(client: postgres.Sql<{}>, userId: string): Promise<void> {
  const expanded = await client<{ present: boolean }[]>`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'universe_nodes'
        and column_name = 'galaxy_memberships'
    ) as present
  `;
  if (expanded[0]?.present) {
    await client.unsafe(`
      alter table "universe_nodes"
        drop constraint if exists "universe_nodes_galaxy_memberships_array"
    `);
    await client.unsafe(`alter table "universe_nodes" drop column if exists "galaxy_memberships"`);
  }
  await client.begin(async (transaction) => {
    await transaction`delete from universe_backups where user_id = ${userId}`;
    await transaction`delete from universe_revisions where user_id = ${userId}`;
    await transaction`delete from universe_relations where user_id = ${userId}`;
    await transaction`delete from universe_nodes where user_id = ${userId}`;
    await transaction`delete from universe_galaxies where user_id = ${userId}`;
    await transaction`delete from universe_meta where user_id = ${userId}`;
    await transaction`delete from users where id = ${userId}`;
  });
}

test("0020 expand migration is additive and fail-closed for every legacy membership source", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const schema = readSchemaSource();
  const fixtureSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const statements = migrationStatements();
  assert.equal(statements.length, 1, "guard and DDL must be one migration operation");
  assert.doesNotMatch(fixtureSource, /JSON\.stringify\([^;\n]*::jsonb/);
  assert.match(migration, /LOCK TABLE[\s\S]*universe_nodes[\s\S]*SHARE ROW EXCLUSIVE MODE/);
  assert.match(migration, /ADD COLUMN "galaxy_memberships" jsonb DEFAULT '\[\]'::jsonb NOT NULL/);
  assert.match(migration, /jsonb_typeof\("universe_nodes"\."galaxy_memberships"\) = 'array'/);
  assert.match(migration, /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
  assert.match(migration, /universe_nodes[\s\S]*cardinality\("galaxies"\)/);
  assert.match(migration, /universe_revisions[\s\S]*snapshot"\s*->\s*'galaxies'/);
  assert.match(migration, /universe_backups[\s\S]*data"\s*->\s*'nodes'/);
  assert.match(migration, /universe_backups[\s\S]*data"\s*->\s*'revisions'/);
  assert.doesNotMatch(migration, /\b(UPDATE|DROP\s+COLUMN|ALTER\s+COLUMN\s+"galaxies")\b/i);
  assert.match(schema, /galaxyMemberships:\s*jsonb\("galaxy_memberships"\)/);
  assert.match(schema, /galaxyMemberships:[\s\S]{0,400}\.default\(sql`'\[\]'::jsonb`\)/);
  assert.match(schema, /galaxyMemberships:[\s\S]{0,500}\.notNull\(\)/);
});

test("0020 succeeds for empty-only legacy data and preserves old inserts", { skip: !runIntegration }, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false, max: 2 });
  let userId: string | undefined;
  try {
    userId = await seedOwner(client, async (transaction, seededUserId) => {
      await transaction`
        insert into universe_revisions (user_id, id, node_id, created_at, reason, snapshot)
        values (${seededUserId}, 'empty-revision', 'node', '2026-08-15T00:00:00Z', 'test', ${transaction.json({ galaxies: [] })})
      `;
      await transaction`
        insert into universe_backups (user_id, id, created_at, reason, data)
        values (
          ${seededUserId},
          'empty-backup',
          '2026-08-15T00:00:00Z',
          'test',
          ${transaction.json({ nodes: [{ galaxies: [] }], revisions: [{ snapshot: { galaxies: [] } }] })}
        )
      `;
    });
    await applyExpand(client);
    const column = await client<{ data_type: string; is_nullable: string; column_default: string | null }[]>`
      select data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'universe_nodes' and column_name = 'galaxy_memberships'
    `;
    assert.deepEqual(column[0], { data_type: "jsonb", is_nullable: "NO", column_default: "'[]'::jsonb" });
    const legacyColumn = await client<{ data_type: string; is_nullable: string }[]>`
      select data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'universe_nodes' and column_name = 'galaxies'
    `;
    assert.deepEqual(legacyColumn[0], { data_type: "ARRAY", is_nullable: "NO" });
    const constraint = await client<{ present: boolean }[]>`
      select exists (
        select 1 from pg_constraint where conname = 'universe_nodes_galaxy_memberships_array'
      ) as present
    `;
    assert.equal(constraint[0]?.present, true);
    await client`
      insert into universe_nodes
        (user_id, id, title, summary, content, type, tags, galaxies, position, created_at, updated_at)
      values
        (${userId}, 'old-app', 'Old', 's', 'c', 'concept', '{}', '{}', '{"x":0,"y":0}'::jsonb,
          '2026-08-15T00:00:00Z', '2026-08-15T00:00:00Z')
    `;
    const inserted = await client<{ galaxies: string[]; galaxy_memberships: unknown }[]>`
      select galaxies, galaxy_memberships from universe_nodes where user_id = ${userId} and id = 'old-app'
    `;
    assert.deepEqual(inserted[0]?.galaxies, []);
    assert.deepEqual(inserted[0]?.galaxy_memberships, []);
  } finally {
    if (userId) await cleanupOwner(client, userId);
    await client.end();
  }
});

test("0020 rejects non-empty node memberships and rolls back the schema change", { skip: !runIntegration }, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false, max: 2 });
  let userId: string | undefined;
  try {
    userId = await seedOwner(client, async (transaction, seededUserId) => {
      await transaction`
        insert into universe_nodes
          (user_id, id, title, summary, content, type, tags, galaxies, position, created_at, updated_at)
        values
          (${seededUserId}, 'node', 'N', 's', 'c', 'concept', '{}', ${["legacy"]}, '{"x":0,"y":0}'::jsonb,
            '2026-08-15T00:00:00Z', '2026-08-15T00:00:00Z')
      `;
    });
    await assert.rejects(applyExpand(client), /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
    const check = await client<{ count: string }[]>`
      select count(*)::text as count from information_schema.columns
      where table_schema = 'public' and table_name = 'universe_nodes' and column_name = 'galaxy_memberships'
    `;
    assert.equal(check[0]?.count, "0");
    const row = await client<{ galaxies: string[] }[]>`
      select galaxies from universe_nodes where user_id = ${userId} and id = 'node'
    `;
    assert.deepEqual(row[0]?.galaxies, ["legacy"]);
  } finally {
    if (userId) await cleanupOwner(client, userId);
    await client.end();
  }
});

test("0020 rejects non-empty or malformed revision memberships and rolls back", { skip: !runIntegration }, async () => {
  for (const snapshot of [{ galaxies: ["legacy"] }, { galaxies: "malformed" }, {}]) {
    const client = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false, max: 2 });
    let userId: string | undefined;
    try {
      userId = await seedOwner(client, async (transaction, seededUserId) => {
        await transaction`
          insert into universe_revisions (user_id, id, node_id, created_at, reason, snapshot)
          values (${seededUserId}, 'revision', 'node', '2026-08-15T00:00:00Z', 'test', ${transaction.json(snapshot)})
        `;
      });
      await assert.rejects(applyExpand(client), /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
      const check = await client<{ count: string }[]>`
        select count(*)::text as count from information_schema.columns
        where table_schema = 'public' and table_name = 'universe_nodes' and column_name = 'galaxy_memberships'
      `;
      assert.equal(check[0]?.count, "0");
    } finally {
      if (userId) await cleanupOwner(client, userId);
      await client.end();
    }
  }
});

test("0020 rejects non-empty or malformed backup node memberships and rolls back", { skip: !runIntegration }, async () => {
  for (const data of [
    { nodes: [{ galaxies: ["legacy"] }], revisions: [] },
    { nodes: [{ galaxies: "malformed" }], revisions: [] },
    { nodes: [{ title: "missing" }], revisions: [] },
  ]) {
    const client = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false, max: 2 });
    let userId: string | undefined;
    try {
      userId = await seedOwner(client, async (transaction, seededUserId) => {
        await transaction`
          insert into universe_backups (user_id, id, created_at, reason, data)
          values (${seededUserId}, 'backup', '2026-08-15T00:00:00Z', 'test', ${transaction.json(data)})
        `;
      });
      await assert.rejects(applyExpand(client), /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
      const check = await client<{ count: string }[]>`
        select count(*)::text as count from information_schema.columns
        where table_schema = 'public' and table_name = 'universe_nodes' and column_name = 'galaxy_memberships'
      `;
      assert.equal(check[0]?.count, "0");
    } finally {
      if (userId) await cleanupOwner(client, userId);
      await client.end();
    }
  }
});

test("0020 rejects non-empty or malformed backup revision memberships and rolls back", { skip: !runIntegration }, async () => {
  for (const data of [
    { nodes: [], revisions: [{ snapshot: { galaxies: ["legacy"] } }] },
    { nodes: [], revisions: [{ snapshot: { galaxies: "malformed" } }] },
    { nodes: [], revisions: [{ snapshot: {} }] },
  ]) {
    const client = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false, max: 2 });
    let userId: string | undefined;
    try {
      userId = await seedOwner(client, async (transaction, seededUserId) => {
        await transaction`
          insert into universe_backups (user_id, id, created_at, reason, data)
          values (${seededUserId}, 'backup', '2026-08-15T00:00:00Z', 'test', ${transaction.json(data)})
        `;
      });
      await assert.rejects(applyExpand(client), /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
      const check = await client<{ count: string }[]>`
        select count(*)::text as count from information_schema.columns
        where table_schema = 'public' and table_name = 'universe_nodes' and column_name = 'galaxy_memberships'
      `;
      assert.equal(check[0]?.count, "0");
    } finally {
      if (userId) await cleanupOwner(client, userId);
      await client.end();
    }
  }
});
