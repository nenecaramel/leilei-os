import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import test from "node:test";
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
      assert.ok(await service.latestRevision(userId, "a"));
      result = await service.restoreLatestRevision(userId, "a", 5);
      assert.equal(result.version, 6);
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
