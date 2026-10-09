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
  "real PostgreSQL Global Search covers four modules, pagination, Memory dates and isolation without side effects",
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

          const datedMemory = randomUUID();
          const undatedMemory = randomUUID();
          const invalidMemory = randomUUID();
          const baseMemory = {
            subjectId: "G", kind: "memory" as const, text: "海边旅行", scopeApplicability: "global" as const,
            settlementStatus: "settled" as const, pathStatus: "current" as const, validityStatus: "valid" as const,
            envelope: {scope: {visibility: "subject_private"}}, createdAt: now, updatedAt: now,
          };
          await tx.insert(schema.runtimeSubjectStates).values([
            {...baseMemory, id: datedMemory, userId: owner, payload: {temporal_v1: {occurredAt: "\t2026-08-12t16:00:00z\n", basis: "user_supplied", sourceMessageId: null}, memory_v1: {reinforcementCount: 7}}},
            {...baseMemory, id: undatedMemory, userId: owner, payload: null},
            {...baseMemory, id: invalidMemory, userId: owner, payload: {manual_v1: {occurredAt: "2026-02-30T00:00:00Z"}}},
            {...baseMemory, id: randomUUID(), userId: owner, envelope: {scope: {visibility: "hidden_system"}}},
            {...baseMemory, id: randomUUID(), userId: other},
            {...baseMemory, id: randomUUID(), userId: owner, subjectId: "other-subject"},
            {...baseMemory, id: randomUUID(), userId: owner, validityStatus: "tombstoned"},
            {...baseMemory, id: randomUUID(), userId: owner, pathStatus: "superseded"},
            {...baseMemory, id: randomUUID(), userId: owner, settlementStatus: "unsettled"},
          ]);
          const literalMemory = randomUUID();
          const unicodeMemory = randomUUID();
          await tx.insert(schema.runtimeSubjectStates).values([
            {...baseMemory, id: literalMemory, userId: owner, text: "literal 100%_marker"},
            {...baseMemory, id: randomUUID(), userId: owner, text: "literal 100xxmarker"},
            {...baseMemory, id: unicodeMemory, userId: owner, text: "cafe\u0301\n  preference"},
          ]);
          const memoryBefore = await tx.select().from(schema.runtimeSubjectStates);
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
            new DrizzleGlobalSearchRepository(tx as never, "G"),
          );

          const result = await service.search({
            userId: owner,
            query: "海边旅行",
            modules: [
              "diary",
              "todo",
              "universe",
              "mind",
            ],
            scope: "active",
            limit: 25,
          });

          assert.equal(result.results.length, 6);
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
              "mind",
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

          const memoryResults = result.results.filter(row => row.entity_type === "mind");
          assert.deepEqual(new Set(memoryResults.map(row => row.entity_id)), new Set([datedMemory, undatedMemory, invalidMemory]));
          assert.ok(memoryResults.every(row => row.stable_name === "" && row.author === null && row.detail_tool === "get_memory"));
          assert.equal(memoryResults.find(row => row.entity_id === datedMemory)?.business_time, "2026-08-12T16:00:00.000Z");
          assert.ok(memoryResults.filter(row => row.entity_id !== datedMemory).every(row => row.business_time === null && row.time_basis === "undated"));
          // Memory uses Beijing occurredAt even if the user's timezone differs.
          await tx.update(schema.userSettings).set({timezone: "America/Los_Angeles"});
          const dated = await service.search({userId: owner, query: "海边旅行", modules: ["mind"], date_from: "2026-08-13", date_to: "2026-08-13"});
          assert.deepEqual(dated.results.map(row => row.entity_id), [datedMemory]);
          assert.deepEqual((await service.search({userId: owner, query: "海边旅行", modules: ["mind"], date_to: "2026-08-12"})).results, []);
          assert.deepEqual((await service.search({userId: owner, query: "海边旅行", modules: ["mind"], scope: "archived"})).results, []);
          for (const author of ["L", "G", "C"]) {
            assert.deepEqual((await service.search({userId: owner, query: "海边旅行", modules: ["mind"], author})).results, []);
          }
          for (const modules of [undefined, ["diary"], ["todo"], ["universe"], ["mind"]]) {
            const full = await service.search({userId: owner, query: "海边旅行", modules, limit: 25});
            const paged: string[] = [];
            let cursor: string | undefined;
            do {
              const page = await service.search({userId: owner, query: "海边旅行", modules, limit: 1, cursor});
              paged.push(...page.results.map(row => `${row.entity_type}:${row.entity_id}`));
              cursor = page.metadata.next_cursor ?? undefined;
              assert.ok(paged.length <= 6, "cursor must terminate without repeats");
            } while (cursor);
            assert.deepEqual(paged, full.results.map(row => `${row.entity_type}:${row.entity_id}`));
            assert.equal(new Set(paged).size, paged.length);
          }
          assert.deepEqual((await service.search({userId: owner, query: "100%_", modules: ["mind"]})).results.map(row => row.entity_id), [literalMemory]);
          assert.deepEqual((await service.search({userId: owner, query: "CAFÉ preference", modules: ["mind"]})).results.map(row => row.entity_id), [unicodeMemory]);
          assert.deepEqual((await service.search({userId: owner, query: "café preference", modules: ["mind"], mode: "phrase"})).results, []);
          const phrase = await service.search({userId: owner, query: "café\n  preference", modules: ["mind"], mode: "phrase"});
          assert.equal(phrase.results[0]?.match_reason, "exact_phrase");
          assert.deepEqual(await tx.select().from(schema.runtimeSubjectStates), memoryBefore);
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
