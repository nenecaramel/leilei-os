import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import test from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/database/schema.js";
import { DrizzleUniverseRepository } from "../src/domains/universe/universe-repository-drizzle.js";
import { UniverseService } from "../src/domains/universe/universe-service.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedUrl = databaseUrl ? new URL(databaseUrl) : null;
const runIntegration = process.env.RUN_UNIVERSE_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (parsedUrl?.hostname === "127.0.0.1" || parsedUrl?.hostname === "localhost");

class RollbackUniverseTest extends Error {}

test("Universe repository preserves atomic revisions, cascades, backups, and versions", { skip: !runIntegration }, async () => {
  const client = postgres(databaseUrl!, { prepare: false, ssl: false, max: 2 });
  const db = drizzle(client, { schema });
  const userId = randomUUID();
  const now = "2026-08-14T00:00:00.000Z";
  const snapshot = { schemaVersion: 2 as const, meta: { name: "Universe", createdAt: now, updatedAt: now }, galaxies: [], nodes: [], relations: [], revisions: [] };
  try {
    await assert.rejects(db.transaction(async (tx) => {
      await tx.insert(schema.users).values({ id: userId, email: `universe-${userId}@example.invalid`, displayName: "Universe test", status: "active", createdAt: new Date(now), updatedAt: new Date(now) });
      const service = new UniverseService(new DrizzleUniverseRepository(tx as never));
      let result = await service.saveUniverse(userId, snapshot, 0);
      assert.equal(result.version, 1);
      result = await service.createNode(userId, { id: "a", title: "A", summary: "A", content: "first", type: "future", tags: [], galaxies: [], position: { x: 1, y: 2 } }, 1);
      assert.equal(result.version, 2);
      result = await service.createNode(userId, { id: "b", title: "B", summary: "B", content: "second", type: "concept", tags: [], galaxies: [], position: { x: 3, y: 4 } }, 2);
      result = await service.createRelation(userId, { source: "a", target: "b", relationType: "supports", strength: 3.5 }, 3);
      assert.equal(result.version, 4);
      result = await service.updateNode(userId, "a", { content: "updated" }, "edit", 4);
      assert.equal(result.version, 5);
      const revision = await service.latestRevision(userId, "a");
      assert.equal(revision?.snapshot.content, "first");
      result = await service.restoreLatestRevision(userId, "a", 5);
      assert.equal(result.version, 6);
      assert.equal(result.snapshot.nodes.find((node) => node.id === "a")?.content, "first");
      const backup = await service.createBackup(userId, "manual");
      assert.equal(backup.data.nodes.length, 2);
      result = await service.deleteNode(userId, "b", 6);
      assert.equal(result.snapshot.nodes.length, 1);
      assert.equal(result.snapshot.relations.length, 0);
      result = await service.restoreBackup(userId, backup.id, 7);
      assert.equal(result.version, 8);
      assert.equal(result.snapshot.nodes.length, 2);
      assert.ok(await service.latestBackup(userId));
      result = await service.saveUniverse(userId, result.snapshot, 8);
      assert.equal(result.version, 9);
      assert.ok(await service.latestBackup(userId));
      result = await service.deleteNode(userId, "a", 9);
      assert.equal(result.snapshot.nodes.length, 1);
      assert.ok(result.snapshot.revisions.some((revision) => revision.nodeId === "a"));
      throw new RollbackUniverseTest();
    }), RollbackUniverseTest);
  } finally {
    await client.end();
  }
});

test("Universe save and backup restore preserve canonical metadata and double precision values", { skip: !runIntegration }, async () => {
  const client = postgres(databaseUrl!, { prepare: false, ssl: false, max: 2 });
  const db = drizzle(client, { schema });
  const userId = randomUUID();
  const createdAt = "2020-01-02T03:04:05.000Z";
  const updatedAt = "2020-02-03T04:05:06.000Z";
  const preciseOrder = 12345.6789012345;
  const preciseStrength = 0.12345678901234567;
  const firstSnapshot = {
    schemaVersion: 2 as const,
    meta: { name: "First", createdAt, updatedAt },
    galaxies: [{ id: "g", title: "Galaxy", description: "d", color: "#fff", order: preciseOrder }],
    nodes: [
      { id: "a", title: "A", summary: "a", content: "a", type: "concept", tags: [], galaxies: [{ id: "g", weight: 1.23456789012345 }], position: { x: 0, y: 0 }, createdAt, updatedAt },
      { id: "b", title: "B", summary: "b", content: "b", type: "concept", tags: [], galaxies: [{ id: "g", weight: 0.2718281828459 }], position: { x: 1, y: 1 }, createdAt, updatedAt },
    ],
    relations: [{ id: "r", source: "a", target: "b", relationType: "supports" as const, strength: preciseStrength, createdAt }],
    revisions: [],
  };
  const secondSnapshot = {
    ...firstSnapshot,
    meta: { name: "Second", createdAt: "2021-03-04T05:06:07.000Z", updatedAt: "2021-04-05T06:07:08.000Z" },
  };
  try {
    await assert.rejects(db.transaction(async (tx) => {
      await tx.insert(schema.users).values({ id: userId, email: `universe-meta-${userId}@example.invalid`, displayName: "Universe test", status: "active", createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) });
      const service = new UniverseService(new DrizzleUniverseRepository(tx as never));
      let result = await service.saveUniverse(userId, firstSnapshot, 0);
      result = await service.saveUniverse(userId, secondSnapshot, result.version);
      assert.deepEqual(result.snapshot.meta, secondSnapshot.meta);
      assert.equal(result.snapshot.galaxies[0]?.order, preciseOrder);
      assert.equal(result.snapshot.relations[0]?.strength, preciseStrength);
      assert.deepEqual(result.snapshot.nodes[0]?.galaxies, firstSnapshot.nodes[0]?.galaxies);
      assert.deepEqual(result.snapshot.nodes[1]?.galaxies, firstSnapshot.nodes[1]?.galaxies);
      const legacyRows = await tx.select({ galaxies: schema.universeNodes.galaxies }).from(schema.universeNodes).where(
        eq(schema.universeNodes.userId, userId),
      );
      assert.deepEqual(legacyRows.map((row) => row.galaxies), [[], []]);
      const backup = await service.createBackup(userId, "metadata");
      const thirdSnapshot = { ...secondSnapshot, meta: { name: "Third", createdAt: "2022-05-06T07:08:09.000Z", updatedAt: "2022-06-07T08:09:10.000Z" } };
      result = await service.saveUniverse(userId, thirdSnapshot, result.version);
      result = await service.restoreBackup(userId, backup.id, result.version);
      assert.deepEqual(result.snapshot.meta, secondSnapshot.meta);
      assert.equal(result.snapshot.schemaVersion, 2);
      throw new RollbackUniverseTest();
    }), RollbackUniverseTest);
  } finally {
    await client.end();
  }
});

test("Universe initialization refuses to overwrite an existing version-zero meta row", { skip: !runIntegration }, async () => {
  const client = postgres(databaseUrl!, { prepare: false, ssl: false, max: 2 });
  const db = drizzle(client, { schema });
  const userId = randomUUID();
  const now = "2026-08-14T00:00:00.000Z";
  const snapshot = { schemaVersion: 2 as const, meta: { name: "incoming", createdAt: now, updatedAt: now }, galaxies: [], nodes: [], relations: [], revisions: [] };
  try {
    await assert.rejects(db.transaction(async (tx) => {
      await tx.insert(schema.users).values({ id: userId, email: `universe-existing-${userId}@example.invalid`, displayName: "Universe test", status: "active", createdAt: new Date(now), updatedAt: new Date(now) });
      await tx.insert(schema.universeMeta).values({ userId, name: "existing", schemaVersion: 2, createdAt: new Date(now), updatedAt: new Date(now), version: 0 });
      const repository = new DrizzleUniverseRepository(tx as never);
      await assert.rejects(repository.saveUniverse(userId, snapshot, 0), (error: unknown) => error instanceof UniverseServiceError && error.code === "VERSION_CONFLICT");
      const [meta] = await tx.select({ name: schema.universeMeta.name, version: schema.universeMeta.version }).from(schema.universeMeta).where(eq(schema.universeMeta.userId, userId));
      assert.deepEqual(meta, { name: "existing", version: 0 });
      throw new RollbackUniverseTest();
    }), RollbackUniverseTest);
  } finally {
    await client.end();
  }
});
