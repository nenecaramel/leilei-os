import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleGlobalSearchRepository } from "../src/domains/global-search/global-search-repository.js";
import { GlobalSearchService } from "../src/domains/global-search/global-search-service.js";

const url = process.env.DATABASE_URL;
const parsed = url ? new URL(url) : null;
const RUN =
  process.env.RUN_GLOBAL_SEARCH_DATABASE_TEST === "1"
  && Boolean(url)
  && (
    parsed?.hostname === "127.0.0.1"
    || parsed?.hostname === "localhost"
  );

class Rollback extends Error {}

test(
  "real PostgreSQL Global Search covers active Diary Todo and Universe without side effects",
  { skip: !RUN },
  async () => {
    const client = postgres(
      url!,
      { max: 1, prepare: false, ssl: false },
    );
    const db = drizzle(client, { schema });

    try {
      await assert.rejects(
        db.transaction(async (tx) => {
          const owner = randomUUID();
          const other = randomUUID();
          const now =
            new Date("2026-08-13T03:00:00.000Z");

          await tx.insert(schema.users).values([
            {
              id: owner,
              email:
                `global-${owner}@example.invalid`,
              displayName: "Owner",
              status: "active",
            },
            {
              id: other,
              email:
                `global-${other}@example.invalid`,
              displayName: "Other",
              status: "active",
            },
          ]);

          await tx
            .insert(schema.userSettings)
            .values([
              {
                userId: owner,
                timezone: "Asia/Shanghai",
              },
              {
                userId: other,
                timezone: "Asia/Shanghai",
              },
            ]);

          const diaryId = randomUUID();
          await tx
            .insert(schema.diaryEntries)
            .values([
              {
                id: diaryId,
                userId: owner,
                title: "旅行计划",
                content: "海边旅行 日记正文",
                date: "2026-08-13",
                tags: ["旅行"],
                mood: "平静",
                source: "chatgpt_mcp",
                author: "C",
                status: "active",
                idempotencyKey:
                  `global-${diaryId}`,
                requestHash: "a".repeat(64),
                createdAt: now,
                updatedAt: now,
              },
              {
                id: randomUUID(),
                userId: other,
                title: "旅行计划",
                content: "不能泄露",
                date: "2026-08-13",
                tags: ["旅行"],
                mood: null,
                source: "chatgpt_mcp",
                status: "active",
                idempotencyKey:
                  `global-other-${other}`,
                requestHash: "b".repeat(64),
                createdAt: now,
                updatedAt: now,
              },
            ]);

          const paperId = randomUUID();
          const todoEntryId = randomUUID();
          await tx.insert(schema.todoPapers).values({
            id: paperId,
            userId: owner,
            businessDate: "2026-08-13",
            author: "C",
            revision: 1,
            createdAt: now,
            updatedAt: now,
          });
          await tx.insert(schema.todoEntries).values({
            id: todoEntryId,
            paperId,
            entryId: "todo-1",
            kind: "pending",
            text: "海边旅行",
            position: 0,
          });

          await tx.insert(schema.universeMeta).values({
            userId: owner,
            name: "我的 Universe",
            schemaVersion: 2,
            createdAt: now,
            updatedAt: now,
            version: 0,
          });
          await tx.insert(schema.universeNodes).values({
            userId: owner,
            id: "node-travel",
            title: "旅行星球",
            summary: "海边旅行",
            content: "Universe content",
            type: "concept",
            tags: ["旅行"],
            galaxies: [],
            galaxyMemberships: [],
            position: { x: 50, y: 50 },
            createdAt: now,
            updatedAt: now,
            importance: "normal",
          });

          const before = {
            tool: (
              await tx
                .select({ value: count() })
                .from(schema.toolCalls)
            )[0]!.value,
            lifecycle: (
              await tx
                .select({ value: count() })
                .from(schema.resourceLifecycleEvents)
            )[0]!.value,
          };

          const service = new GlobalSearchService(
            new DrizzleGlobalSearchRepository(
              tx as never,
            ),
          );

          const result = await service.search({
            userId: owner,
            query: "海边旅行",
            modules: [
              "diary",
              "todo",
              "universe",
            ],
            scope: "active",
            limit: 25,
          });

          assert.equal(result.results.length, 3);
          assert.equal(
            result.results.some(
              (entry) =>
                entry.snippet.includes("不能泄露"),
            ),
            false,
          );

          const diary = result.results.find(
            (entry) =>
              entry.entity_type === "diary",
          );
          assert.equal(
            diary?.entity_id,
            diaryId,
          );
          assert.equal(
            diary?.detail_tool,
            "get_diary",
          );

          const todo = result.results.find(
            (entry) =>
              entry.entity_type === "todo",
          );
          assert.equal(
            todo?.entity_id,
            todoEntryId,
          );
          assert.equal(
            todo?.detail_tool,
            "read_todo_day",
          );
          assert.deepEqual(
            todo?.detail_arguments,
            { date: "2026-08-13" },
          );

          const universe =
            result.results.find(
              (entry) =>
                entry.entity_type === "universe",
            );
          assert.equal(
            universe?.entity_id,
            "node-travel",
          );
          assert.deepEqual(
            universe?.detail_arguments,
            { id: "node-travel" },
          );

          const authored = await service.search({
            userId: owner,
            query: "海边旅行",
            modules: [
              "diary",
              "todo",
              "universe",
            ],
            scope: "active",
            author: "C",
            limit: 25,
          });
          assert.deepEqual(
            authored.results.map((entry) => entry.entity_type).sort(),
            ["diary", "todo"],
          );
          assert.equal(
            authored.results.every((entry) => entry.author === "C"),
            true,
          );
          assert.equal(authored.metadata.searched_author, "C");

          const after = {
            tool: (
              await tx
                .select({ value: count() })
                .from(schema.toolCalls)
            )[0]!.value,
            lifecycle: (
              await tx
                .select({ value: count() })
                .from(schema.resourceLifecycleEvents)
            )[0]!.value,
          };
          assert.deepEqual(after, before);

          throw new Rollback();
        }),
        Rollback,
      );
    } finally {
      await client.end();
    }
  },
);
