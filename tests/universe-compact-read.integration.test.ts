import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/database/schema.js";
import { universeMeta, universeNodes, users } from "../src/database/schema.js";
import { DrizzleUniverseRepository } from "../src/domains/universe/universe-repository-drizzle.js";
import { UniverseService } from "../src/domains/universe/universe-service.js";

const databaseUrl = process.env.DATABASE_URL;
const parsed = databaseUrl ? new URL(databaseUrl) : null;
const run = process.env.RUN_DATABASE_INTEGRATION_TEST === "1" && Boolean(databaseUrl) && (parsed?.hostname === "localhost" || parsed?.hostname === "127.0.0.1");
class RollbackUniverseCompactRead extends Error {}

function connection() {
  const client = postgres(databaseUrl!, { prepare: false, ssl: false, max: 4 });
  return { client, db: drizzle(client, { schema }) };
}

test("Universe compact list is deterministic, paginated, bounded, and ownership scoped", { skip: !run }, async () => {
  const { client, db } = connection();
  try {
    await assert.rejects(db.transaction(async (transaction) => {
      const ownerId = randomUUID();
      const otherId = randomUUID();
      const old = new Date("2026-08-25T00:00:00.000Z");
      const first = new Date("2026-08-25T02:00:00.000Z");
      await transaction.insert(users).values([
        { id: ownerId, email: `universe-compact-${ownerId}@example.invalid`, displayName: "Owner", status: "active" },
        { id: otherId, email: `universe-compact-${otherId}@example.invalid`, displayName: "Other", status: "active" },
      ]);
      await transaction.insert(universeMeta).values({ userId: ownerId, name: "Compact", schemaVersion: 2, version: 4, createdAt: old, updatedAt: first });
      await transaction.insert(universeNodes).values([
        { userId: ownerId, id: "node-a", title: "A", summary: "A summary", content: `${"body".repeat(500)}`, type: "planet", tags: ["a"], galaxyMemberships: [], position: { x: 1, y: 2 }, createdAt: old, updatedAt: first },
        { userId: ownerId, id: "node-b", title: "B", summary: "B summary", content: "B body", type: "planet", tags: ["b"], galaxyMemberships: [], position: { x: 3, y: 4 }, createdAt: old, updatedAt: first },
        { userId: otherId, id: "node-secret", title: "Secret", summary: "Secret", content: "Secret", type: "planet", tags: [], galaxyMemberships: [], position: { x: 5, y: 6 }, createdAt: old, updatedAt: first },
      ]);
      const service = new UniverseService(new DrizzleUniverseRepository(transaction as never));
      const pageOne = await service.listUniverseNodes(ownerId, 1);
      assert.deepEqual(pageOne.nodes.map((node) => node.id), ["node-a"]);
      assert.equal(pageOne.hasMore, true);
      assert.equal("content" in pageOne.nodes[0]!, false);
      const pageTwo = await service.listUniverseNodes(ownerId, 1, { updatedAt: pageOne.nodes[0]!.updatedAt.toISOString(), id: pageOne.nodes[0]!.id });
      assert.deepEqual(pageTwo.nodes.map((node) => node.id), ["node-b"]);
      assert.equal(pageTwo.nodes.some((node) => node.id === "node-secret"), false);
      const exact = await service.readUniverseNode(ownerId, "node-a");
      assert.equal(exact.version, 4);
      assert.equal(exact.node.content.length, 2_000);
      assert.equal(exact.node.id, "node-a");
      throw new RollbackUniverseCompactRead();
    }), RollbackUniverseCompactRead);
  } finally {
    await client.end();
  }
});
