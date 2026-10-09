import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleExportRepository } from "../src/domains/export/export-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedUrl = databaseUrl ? new URL(databaseUrl) : null;
const runIntegration =
  process.env.RUN_EXPORT_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (
    parsedUrl?.hostname === "127.0.0.1"
    || parsedUrl?.hostname === "localhost"
  );

class RollbackExportTest extends Error {}

test(
  "real export repository scopes Diary and Todo to one user",
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
          const early =
            new Date("2026-08-12T00:00:00.000Z");
          const now =
            new Date("2026-08-13T00:00:00.000Z");

          await transaction
            .insert(schema.users)
            .values([
              {
                id: owner,
                email:
                  `export-owner-${owner}@example.invalid`,
                displayName: "Export owner",
                status: "active",
              },
              {
                id: other,
                email:
                  `export-other-${other}@example.invalid`,
                displayName: "Export other",
                status: "active",
              },
            ]);

          const ownerDiaryEarly = randomUUID();
          const ownerDiaryLate = randomUUID();
          const otherDiary = randomUUID();

          await transaction
            .insert(schema.diaryEntries)
            .values([
              {
                id: ownerDiaryEarly,
                userId: owner,
                title: "early diary",
                content: "owner early",
                date: "2026-08-12",
                tags: ["one"],
                mood: null,
                source: "chatgpt_mcp",
                author: "L",
                status: "active",
                idempotencyKey:
                  `export-diary-early-${owner}`,
                requestHash: "a".repeat(64),
                createdAt: early,
                updatedAt: early,
              },
              {
                id: ownerDiaryLate,
                userId: owner,
                title: "late diary",
                content: "owner late",
                date: "2026-08-13",
                tags: ["two"],
                mood: null,
                source: "chatgpt_mcp",
                author: "C",
                status: "archived",
                idempotencyKey:
                  `export-diary-late-${owner}`,
                requestHash: "b".repeat(64),
                createdAt: now,
                updatedAt: now,
              },
              {
                id: otherDiary,
                userId: other,
                title: "other diary",
                content: "OTHER_DIARY_SECRET",
                date: "2026-08-13",
                tags: [],
                mood: null,
                source: "chatgpt_mcp",
                status: "active",
                idempotencyKey:
                  `export-diary-other-${other}`,
                requestHash: "c".repeat(64),
                createdAt: now,
                updatedAt: now,
              },
            ]);

          const paperEarly = randomUUID();
          const paperLate = randomUUID();
          await transaction
            .insert(schema.todoPapers)
            .values([
              {
                id: paperEarly,
                userId: owner,
                businessDate: "2026-08-12",
                author: "L",
                revision: 1,
                createdAt: early,
                updatedAt: early,
              },
              {
                id: paperLate,
                userId: owner,
                businessDate: "2026-08-13",
                author: "C",
                revision: 2,
                createdAt: now,
                updatedAt: now,
              },
              {
                id: randomUUID(),
                userId: other,
                businessDate: "2026-08-13",
                author: "G",
                revision: 1,
                createdAt: now,
                updatedAt: now,
              },
            ]);

          await transaction
            .insert(schema.todoEntries)
            .values([
              {
                paperId: paperEarly,
                entryId: "early",
                kind: "pending",
                text: "early todo",
                position: 0,
              },
              {
                paperId: paperLate,
                entryId: "late",
                kind: "completed",
                text: "late todo",
                position: 0,
              },
            ]);

          const lifecycleId = randomUUID();
          await transaction
            .insert(schema.resourceLifecycleEvents)
            .values({
              id: lifecycleId,
              userId: owner,
              resourceType: "diary",
              resourceId: ownerDiaryLate,
              action: "archive",
              actorType: "user",
              channel: "web",
              metadata: {
                PRIVATE_LIFECYCLE_METADATA: true,
              },
              createdAt: now,
            });

          const toolId = randomUUID();
          await transaction.insert(schema.toolCalls).values({
            id: toolId,
            userId: owner,
            toolName: "write_diary",
            operation: "create",
            resourceType: "diary_entry",
            resourceId: ownerDiaryEarly,
            idempotencyKey:
              `export-tool-${owner}`,
            requestSummary: {
              PRIVATE_REQUEST_SUMMARY: true,
            },
            resultSummary: {
              PRIVATE_RESULT_SUMMARY: true,
            },
            durationMs: 10,
            status: "success",
            errorCode: null,
            createdAt: early,
          });

          const before = {
            diary: (
              await transaction
                .select({ value: count() })
                .from(schema.diaryEntries)
            )[0]!.value,
            todo: (
              await transaction
                .select({ value: count() })
                .from(schema.todoPapers)
            )[0]!.value,
          };

          const logsBefore = {
            lifecycle: await transaction.select().from(schema.resourceLifecycleEvents),
            tools: await transaction.select().from(schema.toolCalls),
          };

          const repository =
            new DrizzleExportRepository(
              transaction as never,
            );

          const diaries =
            await repository.listDiary(owner);
          assert.deepEqual(
            diaries.map((row) => row.id),
            [ownerDiaryEarly, ownerDiaryLate],
          );
          assert.equal(
            JSON.stringify(diaries).includes(
              "OTHER_DIARY_SECRET",
            ),
            false,
          );
          assert.equal(
            diaries[1]?.author,
            "C",
          );

          const papers =
            await repository.listTodo(owner);
          assert.deepEqual(
            papers.map((row) => row.date),
            ["2026-08-12", "2026-08-13"],
          );
          assert.equal(
            papers[1]?.author,
            "C",
          );
          assert.equal(
            papers[1]?.entries[0]?.text,
            "late todo",
          );

          const after = {
            diary: (
              await transaction
                .select({ value: count() })
                .from(schema.diaryEntries)
            )[0]!.value,
            todo: (
              await transaction
                .select({ value: count() })
                .from(schema.todoPapers)
            )[0]!.value,
          };
          assert.deepEqual(after, before);
          assert.deepEqual({
            lifecycle: await transaction.select().from(schema.resourceLifecycleEvents),
            tools: await transaction.select().from(schema.toolCalls),
          }, logsBefore);

          throw new RollbackExportTest();
        }),
        RollbackExportTest,
      );
    } finally {
      await client.end();
    }
  },
);
