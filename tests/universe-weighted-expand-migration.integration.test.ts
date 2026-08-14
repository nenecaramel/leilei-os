import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import postgres from "postgres";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = `${root}/drizzle/0020_weighted_galaxy_expand.sql`;
const schemaPath = `${root}/src/database/schema.ts`;
const runIntegration = process.env.RUN_UNIVERSE_WEIGHTED_EXPAND_DATABASE_TEST === "1"
  && Boolean(process.env.DATABASE_URL)
  && ["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname);

class RollbackExpand extends Error {}

function migrationStatements(): string[] {
  return readFileSync(migrationPath, "utf8")
    .split(/\n?--> statement-breakpoint\s*/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyExpand(transaction: postgres.TransactionSql<{}>): Promise<void> {
  for (const statement of migrationStatements()) {
    await transaction.unsafe(statement);
  }
}

async function withOwner<T>(
  client: postgres.Sql,
  callback: (transaction: postgres.TransactionSql<{}>, userId: string) => Promise<T>,
): Promise<T> {
  return client.begin(async (transaction) => callback(transaction, randomUUID())) as Promise<T>;
}

async function insertUser(transaction: postgres.TransactionSql<{}>, userId: string): Promise<void> {
  const now = new Date("2026-08-15T00:00:00.000Z");
  await transaction`
    insert into users (id, email, display_name, status, created_at, updated_at)
    values (${userId}, ${`weighted-expand-${userId}@example.invalid`}, 'Expand test', 'active', ${now}, ${now})
  `;
}

test("0020 expand migration is additive and fail-closed for every legacy membership source", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const schema = readFileSync(schemaPath, "utf8");
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
  try {
    await assert.rejects(
      withOwner(client, async (transaction, userId) => {
        await insertUser(transaction, userId);
        await transaction`
          insert into universe_revisions (user_id, id, node_id, created_at, reason, snapshot)
          values (${userId}, 'empty-revision', 'node', '2026-08-15T00:00:00Z', 'test', ${JSON.stringify({ galaxies: [] })})
        `;
        await transaction`
          insert into universe_backups (user_id, id, created_at, reason, data)
          values (
            ${userId},
            'empty-backup',
            '2026-08-15T00:00:00Z',
            'test',
            ${JSON.stringify({ nodes: [{ galaxies: [] }], revisions: [{ snapshot: { galaxies: [] } }] })}
          )
        `;
        await applyExpand(transaction);
        const column = await transaction<{ data_type: string; is_nullable: string; column_default: string | null }[]>`
          select data_type, is_nullable, column_default
          from information_schema.columns
          where table_schema = 'public' and table_name = 'universe_nodes' and column_name = 'galaxy_memberships'
        `;
        assert.deepEqual(column, [{ data_type: "jsonb", is_nullable: "NO", column_default: "'[]'::jsonb" }]);
        const legacyColumn = await transaction<{ data_type: string; is_nullable: string }[]>`
          select data_type, is_nullable
          from information_schema.columns
          where table_schema = 'public' and table_name = 'universe_nodes' and column_name = 'galaxies'
        `;
        assert.deepEqual(legacyColumn, [{ data_type: "ARRAY", is_nullable: "NO" }]);
        const constraint = await transaction<{ present: boolean }[]>`
          select exists (
            select 1 from pg_constraint where conname = 'universe_nodes_galaxy_memberships_array'
          ) as present
        `;
        assert.equal(constraint[0]?.present, true);
        await transaction`
          insert into universe_nodes
            (user_id, id, title, summary, content, type, tags, galaxies, position, created_at, updated_at)
          values
            (${userId}, 'old-app', 'Old', 's', 'c', 'concept', '{}', '{}', '{"x":0,"y":0}'::jsonb,
              '2026-08-15T00:00:00Z', '2026-08-15T00:00:00Z')
        `;
        const inserted = await transaction<{ galaxies: string[]; galaxy_memberships: unknown }[]>`
          select galaxies, galaxy_memberships from universe_nodes where user_id = ${userId} and id = 'old-app'
        `;
        assert.deepEqual(inserted[0]?.galaxies, []);
        assert.deepEqual(inserted[0]?.galaxy_memberships, []);
        throw new RollbackExpand();
      }),
      (error: unknown) => error instanceof RollbackExpand,
    );
  } finally {
    await client.end();
  }
});

test("0020 rejects non-empty node memberships and rolls back the schema change", { skip: !runIntegration }, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false, max: 2 });
  try {
    await assert.rejects(withOwner(client, async (transaction, userId) => {
      await insertUser(transaction, userId);
      await transaction`
        insert into universe_nodes
          (user_id, id, title, summary, content, type, tags, galaxies, position, created_at, updated_at)
        values
          (${userId}, 'node', 'N', 's', 'c', 'concept', '{}', ${["legacy"]}, '{"x":0,"y":0}'::jsonb,
            '2026-08-15T00:00:00Z', '2026-08-15T00:00:00Z')
      `;
      await assert.rejects(applyExpand(transaction), /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
    }), /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
    const check = await client<{ count: string }[]>`
      select count(*)::text as count from information_schema.columns
      where table_schema = 'public' and table_name = 'universe_nodes' and column_name = 'galaxy_memberships'
    `;
    assert.equal(check[0]?.count, "0");
  } finally {
    await client.end();
  }
});

test("0020 rejects non-empty or malformed revision memberships and rolls back", { skip: !runIntegration }, async () => {
  for (const snapshot of [{ galaxies: ["legacy"] }, { galaxies: "malformed" }, {}]) {
    const client = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false, max: 2 });
    try {
      await assert.rejects(withOwner(client, async (transaction, userId) => {
        await insertUser(transaction, userId);
        await transaction`
          insert into universe_revisions (user_id, id, node_id, created_at, reason, snapshot)
          values (${userId}, 'revision', 'node', '2026-08-15T00:00:00Z', 'test', ${JSON.stringify(snapshot)})
        `;
        await assert.rejects(applyExpand(transaction), /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
      }), /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
    } finally {
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
    try {
      await assert.rejects(withOwner(client, async (transaction, userId) => {
        await insertUser(transaction, userId);
        await transaction`
          insert into universe_backups (user_id, id, created_at, reason, data)
          values (${userId}, 'backup', '2026-08-15T00:00:00Z', 'test', ${JSON.stringify(data)})
        `;
        await assert.rejects(applyExpand(transaction), /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
      }), /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
    } finally {
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
    try {
      await assert.rejects(withOwner(client, async (transaction, userId) => {
        await insertUser(transaction, userId);
        await transaction`
          insert into universe_backups (user_id, id, created_at, reason, data)
          values (${userId}, 'backup', '2026-08-15T00:00:00Z', 'test', ${JSON.stringify(data)})
        `;
        await assert.rejects(applyExpand(transaction), /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
      }), /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
    } finally {
      await client.end();
    }
  }
});
