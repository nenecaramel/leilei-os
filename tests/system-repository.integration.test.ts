import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleSystemRepository } from "../src/domains/system/system-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedUrl = databaseUrl ? new URL(databaseUrl) : null;
const runIntegration =
  process.env.RUN_SYSTEM_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (
    parsedUrl?.hostname === "127.0.0.1"
    || parsedUrl?.hostname === "localhost"
  );

class RollbackSystemTest extends Error {}

test(
  "real System repository scopes active-module counts and activity to one user",
  { skip: !runIntegration },
  async () => {
    const client = postgres(
      databaseUrl!,
      { max: 1, prepare: false, ssl: false },
    );
    const db = drizzle(client, { schema });

    try {
      await assert.rejects(
        db.transaction(async (transaction) => {
          const owner = randomUUID();
          const other = randomUUID();
          const now =
            new Date("2026-08-09T00:00:00.000Z");

          await transaction
            .insert(schema.users)
            .values([
              {
                id: owner,
                email:
                  `system-owner-${owner}@example.invalid`,
                displayName: "System owner",
                status: "active",
              },
              {
                id: other,
                email:
                  `system-other-${other}@example.invalid`,
                displayName: "System other",
                status: "active",
              },
            ]);

          const ownerActiveDiary = randomUUID();
          const ownerArchivedDiary = randomUUID();
          const otherDiary = randomUUID();

          await transaction
            .insert(schema.diaryEntries)
            .values([
              {
                id: ownerActiveDiary,
                userId: owner,
                title: "owner active",
                content: "owner",
                date: "2026-08-09",
                tags: [],
                mood: null,
                source: "chatgpt_mcp",
                status: "active",
                idempotencyKey:
                  `system-${owner}-active`,
                requestHash: "a".repeat(64),
                createdAt: now,
                updatedAt: now,
              },
              {
                id: ownerArchivedDiary,
                userId: owner,
                title: "owner archived",
                content: "owner",
                date: "2026-08-08",
                tags: [],
                mood: null,
                source: "chatgpt_mcp",
                status: "archived",
                idempotencyKey:
                  `system-${owner}-archived`,
                requestHash: "b".repeat(64),
                createdAt: now,
                updatedAt: now,
              },
              {
                id: otherDiary,
                userId: other,
                title: "other diary",
                content: "other",
                date: "2026-08-09",
                tags: [],
                mood: null,
                source: "chatgpt_mcp",
                status: "active",
                idempotencyKey:
                  `system-${other}-active`,
                requestHash: "c".repeat(64),
                createdAt: now,
                updatedAt: now,
              },
            ]);

          await transaction
            .insert(schema.todoPapers)
            .values([
              {
                id: randomUUID(),
                userId: owner,
                businessDate: "2026-08-09",
                author: "L",
                revision: 1,
                createdAt: now,
                updatedAt: now,
              },
              {
                id: randomUUID(),
                userId: owner,
                businessDate: "2026-08-10",
                author: "C",
                revision: 1,
                createdAt: now,
                updatedAt: now,
              },
              {
                id: randomUUID(),
                userId: other,
                businessDate: "2026-08-09",
                author: "G",
                revision: 1,
                createdAt: now,
                updatedAt: now,
              },
            ]);

          await transaction
            .insert(schema.resourceLifecycleEvents)
            .values([
              {
                id: randomUUID(),
                userId: owner,
                resourceType: "diary",
                resourceId: ownerArchivedDiary,
                action: "archive",
                actorType: "user",
                channel: "web",
                metadata: {},
                createdAt: now,
              },
              {
                id: randomUUID(),
                userId: other,
                resourceType: "diary",
                resourceId: otherDiary,
                action: "archive",
                actorType: "user",
                channel: "web",
                metadata: {},
                createdAt: now,
              },
            ]);

          await transaction
            .insert(schema.toolCalls)
            .values([
              {
                id: randomUUID(),
                userId: owner,
                toolName: "write_diary",
                operation: "create",
                resourceType: "diary_entry",
                resourceId: ownerActiveDiary,
                idempotencyKey:
                  `system-key-${owner}`,
                requestSummary: {},
                resultSummary: {},
                durationMs: 2,
                status: "success",
                errorCode: null,
                createdAt: now,
              },
              {
                id: randomUUID(),
                userId: other,
                toolName: "write_diary",
                operation: "create",
                resourceType: "diary_entry",
                resourceId: otherDiary,
                idempotencyKey:
                  `system-key-${other}`,
                requestSummary: {},
                resultSummary: {},
                durationMs: 2,
                status: "success",
                errorCode: null,
                createdAt: now,
              },
            ]);

          const repository =
            new DrizzleSystemRepository(
              transaction as never,
            );

          assert.deepEqual(
            await repository.readDataSummary(owner),
            {
              diary: {
                active: 1,
                archived: 1,
              },
              diary_comments: { count: 0 },
              todo: { active: 2, count: 2 },
              workspaces: { count: 0 },
              conversations: { active: 0, archived: 0 },
              mind: { count: 0 },
              universe: { nodes: 0 },
            },
          );

          const lifecycle =
            await repository.listLifecycleActivity(
              owner,
              10,
            );
          assert.equal(lifecycle.length, 1);
          assert.equal(
            lifecycle[0]?.resourceType,
            "diary",
          );

          const tools =
            await repository.listToolActivity(
              owner,
              10,
            );
          assert.deepEqual(
            tools.map((row) => row.source),
            ["mcp"],
          );
          assert.deepEqual(
            tools.map((row) => row.toolName),
            ["write_diary"],
          );

          throw new RollbackSystemTest();
        }),
        RollbackSystemTest,
      );
    } finally {
      await client.end();
    }
  },
);
