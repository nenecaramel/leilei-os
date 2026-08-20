import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import {
  coreMemories,
  mcpWriteIdempotency,
  resourceLifecycleEvents,
  users,
} from "../src/database/schema.js";
import { DrizzleMemoryRepository } from "../src/domains/memory/memory-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
const RUN = process.env.RUN_PERMANENT_DELETE_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (parsedDatabaseUrl?.hostname === "localhost" || parsedDatabaseUrl?.hostname === "127.0.0.1");

class RollbackPermanentDeleteTest extends Error {}

test(
  "real Memory permanent delete removes content and prior lifecycle rows but retains MCP idempotency",
  { skip: !RUN },
  async () => {
    const client = postgres(databaseUrl!, { max: 2, prepare: false, ssl: false });
    const database = { db: drizzle(client, { schema }), close: () => client.end() };
    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const userId = randomUUID();
          const memoryId = randomUUID();
          const now = new Date("2026-08-20T00:00:00.000Z");

          await transaction.insert(users).values({
            id: userId,
            email: `memory-delete-${userId}@example.invalid`,
            displayName: "Memory delete owner",
            status: "active",
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(coreMemories).values({
            id: memoryId,
            userId,
            category: "goal",
            key: `delete-${memoryId}`,
            content: "must disappear",
            tags: ["private"],
            visibility: "assistant",
            source: "web",
            status: "archived",
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(resourceLifecycleEvents).values([
            {
              userId,
              resourceType: "memory",
              resourceId: memoryId,
              action: "archive",
              actorType: "user",
              channel: "web",
              metadata: { title: "must not survive" },
              createdAt: now,
            },
            {
              userId,
              resourceType: "memory",
              resourceId: memoryId,
              action: "restore",
              actorType: "user",
              channel: "web",
              metadata: {},
              createdAt: now,
            },
          ]);
          await transaction.insert(mcpWriteIdempotency).values({
            userId,
            toolName: "write_memory",
            idempotencyKey: "memory-delete-key-01",
            requestHash: "a".repeat(64),
            resourceType: "memory",
            resourceId: memoryId,
            createdAt: now,
          });

          const repository = new DrizzleMemoryRepository(transaction as never);
          assert.equal(await repository.permanentlyDeleteMemory!({
            userId,
            id: memoryId,
            actorType: "user",
            channel: "web",
          }), true);
          assert.equal(await repository.permanentlyDeleteMemory!({
            userId,
            id: memoryId,
            actorType: "user",
            channel: "web",
          }), false);

          const memories = await transaction
            .select({ id: coreMemories.id })
            .from(coreMemories)
            .where(eq(coreMemories.id, memoryId));
          assert.deepEqual(memories, []);

          const idempotencyRows = await transaction
            .select({ resourceId: mcpWriteIdempotency.resourceId })
            .from(mcpWriteIdempotency)
            .where(and(
              eq(mcpWriteIdempotency.userId, userId),
              eq(mcpWriteIdempotency.resourceType, "memory"),
              eq(mcpWriteIdempotency.resourceId, memoryId),
            ));
          assert.deepEqual(idempotencyRows, [{ resourceId: memoryId }]);

          const events = await transaction
            .select({
              action: resourceLifecycleEvents.action,
              metadata: resourceLifecycleEvents.metadata,
            })
            .from(resourceLifecycleEvents)
            .where(and(
              eq(resourceLifecycleEvents.userId, userId),
              eq(resourceLifecycleEvents.resourceType, "memory"),
              eq(resourceLifecycleEvents.resourceId, memoryId),
            ));
          assert.deepEqual(events, [{ action: "permanent_delete", metadata: {} }]);

          const unrelated = await transaction
            .select({ id: resourceLifecycleEvents.id })
            .from(resourceLifecycleEvents)
            .where(inArray(resourceLifecycleEvents.resourceId, [memoryId]));
          assert.equal(unrelated.length, 1);

          throw new RollbackPermanentDeleteTest();
        }),
        RollbackPermanentDeleteTest,
      );
    } finally {
      await database.close();
    }
  },
);
