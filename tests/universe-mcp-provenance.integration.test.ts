import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import test from "node:test";
import * as schema from "../src/database/schema.js";
import { DrizzleUniverseRepository } from "../src/domains/universe/universe-repository-drizzle.js";
import { UniverseService, UniverseServiceError } from "../src/domains/universe/universe-service.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedUrl = databaseUrl ? new URL(databaseUrl) : null;
const runIntegration = process.env.RUN_UNIVERSE_MCP_PROVENANCE_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (parsedUrl?.hostname === "127.0.0.1" || parsedUrl?.hostname === "localhost");

class RollbackProvenanceTest extends Error {}

test("Universe MCP provenance mutations preserve node content, revisions, ownership, status, and CAS", { skip: !runIntegration }, async () => {
  const client = postgres(databaseUrl!, { prepare: false, ssl: false, max: 4 });
  const db = drizzle(client, { schema });
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const activeDiaryId = randomUUID();
  const archivedDiaryId = randomUUID();
  const foreignDiaryId = randomUUID();
  const deletedDiaryId = randomUUID();
  const now = "2026-08-21T00:00:00.000Z";
  const diary = (id: string, owner: string, status: "active" | "archived") => ({
    id,
    userId: owner,
    title: `${status} diary`,
    content: "private body must not be exposed",
    date: "2026-08-21",
    tags: ["source"],
    source: "chatgpt_mcp" as const,
    status,
    idempotencyKey: `provenance-${id}`,
    requestHash: "a".repeat(64),
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
  const snapshot = {
    schemaVersion: 2 as const,
    meta: { name: "Provenance", createdAt: now, updatedAt: now },
    galaxies: [],
    nodes: [
      { id: "node-1", title: "Node", summary: "summary", content: "canonical content", type: "concept", tags: [], galaxies: [], position: { x: 10, y: 20 }, createdAt: now, updatedAt: now },
      { id: "node-2", title: "Other", summary: "", content: "", type: "concept", tags: [], galaxies: [], position: { x: 30, y: 40 }, createdAt: now, updatedAt: now },
    ],
    relations: [{ id: "edge-1", source: "node-1", target: "node-2", relationType: "supports" as const, strength: 0.5, createdAt: now }],
    revisions: [],
  };

  try {
    await assert.rejects(db.transaction(async (tx) => {
      await tx.insert(schema.users).values([
        { id: userId, email: `provenance-${userId}@example.invalid`, displayName: "Provenance", status: "active" },
        { id: otherUserId, email: `provenance-${otherUserId}@example.invalid`, displayName: "Other", status: "active" },
      ]);
      await tx.insert(schema.diaryEntries).values([
        diary(activeDiaryId, userId, "active"),
        diary(archivedDiaryId, userId, "archived"),
        diary(foreignDiaryId, otherUserId, "active"),
        diary(deletedDiaryId, userId, "active"),
      ]);
      const service = new UniverseService(new DrizzleUniverseRepository(tx as never));
      let version = (await service.saveUniverse(userId, snapshot, 0)).version;
      await tx.delete(schema.diaryEntries).where(eq(schema.diaryEntries.id, deletedDiaryId));

      const addedActive = await service.addUniverseDiarySource(userId, "node-1", activeDiaryId, version);
      assert.equal(addedActive.version, version + 1);
      version = addedActive.version;
      const addedArchived = await service.addUniverseDiarySource(userId, "node-1", archivedDiaryId, version);
      version = addedArchived.version;

      const read = await service.getUniverseDiarySources(userId, "node-1");
      assert.equal(read.version, version);
      assert.deepEqual(read.sources.map((source) => ({ diaryId: source.diaryId, status: source.status })).sort((a, b) => a.diaryId.localeCompare(b.diaryId)), [
        { diaryId: activeDiaryId, status: "active" },
        { diaryId: archivedDiaryId, status: "archived" },
      ].sort((a, b) => a.diaryId.localeCompare(b.diaryId)));
      assert.doesNotMatch(JSON.stringify(read), /private body/);

      await assert.rejects(
        service.addUniverseDiarySource(userId, "node-1", activeDiaryId, version),
        (error: unknown) => error instanceof UniverseServiceError && error.code === "DIARY_SOURCE_CONFLICT",
      );
      await assert.rejects(
        service.addUniverseDiarySource(userId, "node-1", foreignDiaryId, version),
        (error: unknown) => error instanceof UniverseServiceError && error.code === "DIARY_SOURCE_NOT_FOUND",
      );
      await assert.rejects(
        service.addUniverseDiarySource(userId, "node-1", deletedDiaryId, version),
        (error: unknown) => error instanceof UniverseServiceError && error.code === "DIARY_SOURCE_NOT_FOUND",
      );
      await assert.rejects(
        service.addUniverseDiarySource(userId, "missing-node", activeDiaryId, version),
        (error: unknown) => error instanceof UniverseServiceError && error.code === "NODE_NOT_FOUND",
      );
      await assert.rejects(
        service.addUniverseDiarySource(userId, "node-1", activeDiaryId, version - 1),
        (error: unknown) => error instanceof UniverseServiceError && error.code === "VERSION_CONFLICT",
      );

      const afterFailed = await service.loadUniverse(userId);
      assert.equal(afterFailed.version, version);
      assert.equal(afterFailed.snapshot.nodes.find((node) => node.id === "node-1")?.content, "canonical content");
      assert.deepEqual(afterFailed.snapshot.revisions, []);

      const removed = await service.deleteUniverseDiarySource(userId, "node-1", activeDiaryId, version);
      version = removed.version;
      assert.equal((await service.getUniverseDiarySources(userId, "node-1")).sources.length, 1);
      const beforeDeleteStale = await service.loadUniverse(userId);
      await assert.rejects(
        service.deleteUniverseDiarySource(userId, "node-1", archivedDiaryId, version - 1),
        (error: unknown) => error instanceof UniverseServiceError && error.code === "VERSION_CONFLICT",
      );
      const afterDeleteStale = await service.loadUniverse(userId);
      assert.equal(afterDeleteStale.version, version);
      assert.deepEqual(afterDeleteStale.snapshot, beforeDeleteStale.snapshot);
      assert.deepEqual((await service.getUniverseDiarySources(userId, "node-1")).sources.map((source) => source.diaryId), [archivedDiaryId]);
      assert.deepEqual(afterDeleteStale.snapshot.revisions, []);
      await assert.rejects(
        service.deleteUniverseDiarySource(userId, "node-1", activeDiaryId, version),
        (error: unknown) => error instanceof UniverseServiceError && error.code === "DIARY_SOURCE_NOT_FOUND",
      );

      const deletedRelation = await service.deleteRelation(userId, "edge-1", version);
      assert.equal(deletedRelation.version, version + 1);
      assert.equal(deletedRelation.snapshot.relations.length, 0);
      await assert.rejects(
        service.deleteRelation(userId, "edge-1", deletedRelation.version),
        (error: unknown) => error instanceof UniverseServiceError && error.code === "RELATION_NOT_FOUND",
      );

      await tx.update(schema.users).set({ status: "disabled" }).where(eq(schema.users.id, userId));
      await assert.rejects(
        service.deleteUniverseDiarySource(userId, "node-1", archivedDiaryId, deletedRelation.version),
        (error: unknown) => error instanceof UniverseServiceError && error.code === "USER_DISABLED",
      );
      throw new RollbackProvenanceTest();
    }), RollbackProvenanceTest);
  } finally {
    await client.end();
  }
});
