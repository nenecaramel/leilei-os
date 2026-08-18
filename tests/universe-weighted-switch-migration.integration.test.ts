import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import postgres from "postgres";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration0020 = `${root}/drizzle/0020_weighted_galaxy_expand.sql`;
const migration0021 = `${root}/drizzle/0021_universe_weighted_membership_switch.sql`;
const runIntegration = process.env.RUN_UNIVERSE_WEIGHTED_SWITCH_DATABASE_TEST === "1"
  && Boolean(process.env.DATABASE_URL)
  && ["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname);

function migration(path: string): string {
  const statements = readFileSync(path, "utf8").split(/\n?--> statement-breakpoint\s*/).filter((value) => value.trim());
  assert.equal(statements.length, 1, `${path} must be one atomic operation`);
  return statements[0]!.trim();
}

async function reset(client: postgres.Sql<{}>): Promise<void> {
  await client.unsafe('ALTER TABLE "universe_nodes" DROP CONSTRAINT IF EXISTS "universe_nodes_legacy_galaxies_empty"');
  await client.unsafe('ALTER TABLE "universe_nodes" DROP CONSTRAINT IF EXISTS "universe_nodes_galaxy_memberships_array"');
  await client.unsafe('ALTER TABLE "universe_nodes" DROP COLUMN IF EXISTS "galaxy_memberships"');
  await client.unsafe("TRUNCATE universe_backups, universe_revisions, universe_relations, universe_nodes, universe_galaxies, universe_meta CASCADE");
}

async function user(client: postgres.Sql<{}>, id: string): Promise<void> {
  await client`
    INSERT INTO users (id, email, display_name, status, created_at, updated_at)
    VALUES (${id}, ${`weighted-switch-${id}@example.invalid`}, 'Switch test', 'active', now(), now())
  `;
}

async function cleanup(client: postgres.Sql<{}>, id: string): Promise<void> {
  await client`DELETE FROM users WHERE id = ${id}`;
}

async function teardown(client: postgres.Sql<{}>, id: string): Promise<void> {
  await cleanup(client, id).catch(() => undefined);
  await reset(client).catch(() => undefined);
}

async function prepare(client: postgres.Sql<{}>, id: string): Promise<void> {
  await reset(client);
  await user(client, id);
  await client.unsafe(migration(migration0020));
}

test("0021 succeeds for empty legacy state and rejects stale legacy writes", { skip: !runIntegration }, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false, max: 2 });
  const id = randomUUID();
  try {
    await prepare(client, id);
    await client.unsafe(migration(migration0021));
    const constraints = await client<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'universe_nodes_legacy_galaxies_empty') AS present
    `;
    assert.equal(constraints[0]?.present, true);
    await assert.rejects(client`
      INSERT INTO universe_nodes (user_id,id,title,summary,content,type,tags,galaxies,galaxy_memberships,position,created_at,updated_at)
      VALUES (${id},'old','N','s','c','concept','{}','{legacy}','[]'::jsonb,'{"x":0,"y":0}'::jsonb,now(),now())
    `, (error: unknown) => (error as { code?: unknown }).code === "23514");
    await client`
      INSERT INTO universe_nodes (user_id,id,title,summary,content,type,tags,galaxies,galaxy_memberships,position,created_at,updated_at)
      VALUES (${id},'weighted','N','s','c','concept','{}','{}',${client.json([{ id: "g", weight: 1.23456789012345 }])},'{"x":0,"y":0}'::jsonb,now(),now())
    `;
    const [row] = await client<{ value: unknown }[]>`SELECT galaxy_memberships AS value FROM universe_nodes WHERE user_id=${id} AND id='weighted'`;
    assert.deepEqual(row?.value, [{ id: "g", weight: 1.23456789012345 }]);
  } finally {
    await teardown(client, id);
    await client.end();
  }
});

const unsafeCases: Array<{ name: string; seed: (client: postgres.Sql<{}>, id: string) => Promise<void> }> = [
  {
    name: "node membership",
    seed: (client, id) => client`
      INSERT INTO universe_nodes (user_id,id,title,summary,content,type,tags,galaxies,galaxy_memberships,position,created_at,updated_at)
      VALUES (${id},'node','N','s','c','concept','{}','{legacy}','[]'::jsonb,'{"x":0,"y":0}'::jsonb,now(),now())
    `.then(() => undefined),
  },
  {
    name: "revision membership",
    seed: (client, id) => client`
      INSERT INTO universe_revisions (user_id,id,node_id,created_at,reason,snapshot)
      VALUES (${id},'revision','node',now(),'test',${client.json({ galaxies: [{ id: "g", weight: 1 }] })})
    `.then(() => undefined),
  },
  {
    name: "malformed revision membership",
    seed: (client, id) => client`
      INSERT INTO universe_revisions (user_id,id,node_id,created_at,reason,snapshot)
      VALUES (${id},'revision-malformed','node',now(),'test',${client.json({ galaxies: "malformed" })})
    `.then(() => undefined),
  },
  {
    name: "backup node membership",
    seed: (client, id) => client`
      INSERT INTO universe_backups (user_id,id,created_at,reason,data)
      VALUES (${id},'backup-node',now(),'test',${client.json({ nodes: [{ galaxies: [{ id: "g", weight: 1 }] }], revisions: [] })})
    `.then(() => undefined),
  },
  {
    name: "malformed backup node membership",
    seed: (client, id) => client`
      INSERT INTO universe_backups (user_id,id,created_at,reason,data)
      VALUES (${id},'backup-node-malformed',now(),'test',${client.json({ nodes: [{}], revisions: [] })})
    `.then(() => undefined),
  },
  {
    name: "backup revision membership",
    seed: (client, id) => client`
      INSERT INTO universe_backups (user_id,id,created_at,reason,data)
      VALUES (${id},'backup-revision',now(),'test',${client.json({ nodes: [], revisions: [{ snapshot: { galaxies: [{ id: "g", weight: 1 }] } }] })})
    `.then(() => undefined),
  },
  {
    name: "malformed backup revision membership",
    seed: (client, id) => client`
      INSERT INTO universe_backups (user_id,id,created_at,reason,data)
      VALUES (${id},'backup-revision-malformed',now(),'test',${client.json({ nodes: [], revisions: [{ snapshot: "malformed" }] })})
    `.then(() => undefined),
  },
];

for (const unsafeCase of unsafeCases) {
  test(`0021 rejects ${unsafeCase.name} and rolls back the constraint`, { skip: !runIntegration }, async () => {
    const client = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false, max: 2 });
    const id = randomUUID();
    try {
      await prepare(client, id);
      await unsafeCase.seed(client, id);
      await assert.rejects(client.unsafe(migration(migration0021)), /UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT/);
      const [constraint] = await client<{ present: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'universe_nodes_legacy_galaxies_empty') AS present
      `;
      assert.equal(constraint?.present, false);
    } finally {
      await teardown(client, id);
      await client.end();
    }
  });
}
