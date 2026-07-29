import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  diaryEntries,
  resourceLifecycleEvents,
  users,
} from "../src/database/schema.js";
import {
  DrizzleDiaryRepository,
} from "../src/domains/diary/diary-repository.js";
import { DiaryService } from "../src/domains/diary/diary-service.js";

const RUN_INTEGRATION =
  process.env.RUN_DATABASE_INTEGRATION_TEST === "1" &&
  Boolean(process.env.DATABASE_URL);

class RollbackDiarySearchTest extends Error {}
class RollbackDiaryLifecycleTest extends Error {}

test(
  "real Diary repository applies exact tags, literal search, ownership, dates and AND filters before limit",
  { skip: !RUN_INTEGRATION },
  async () => {
    const database = createDatabase(process.env.DATABASE_URL!);
    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const owner = randomUUID();
          const other = randomUUID();
          const exactId = randomUUID();
          const partialId = randomUUID();
          const now = new Date("2026-07-26T08:00:00Z");
          await transaction.insert(users).values([
            {
              id: owner,
              email: `diary-search-${owner}@example.invalid`,
              displayName: "Diary integration owner",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
            {
              id: other,
              email: `diary-search-${other}@example.invalid`,
              displayName: "Diary integration other",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
          ]);
          const record = (input: {
            id: string;
            userId: string;
            title: string;
            content: string;
            date: string;
            tags: string[];
            mood: string;
          }) => ({
            ...input,
            source: "chatgpt_mcp" as const,
            idempotencyKey: `integration:${input.id}`,
            requestHash: createHash("sha256").update(input.id).digest("hex"),
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(diaryEntries).values([
            record({
              id: exactId,
              userId: owner,
              title: "Literal 100% _complete_ \\ trip",
              content: "Japan private journal",
              date: "2026-07-07",
              tags: ["filter-test", "Japan"],
              mood: "happy",
            }),
            record({
              id: partialId,
              userId: owner,
              title: "Other",
              content: "Other content",
              date: "2026-07-01",
              tags: ["filter"],
              mood: "calm",
            }),
            record({
              id: randomUUID(),
              userId: other,
              title: "Other owner",
              content: "Japan private journal",
              date: "2026-07-07",
              tags: ["filter-test"],
              mood: "happy",
            }),
          ]);

          const service = new DiaryService(
            new DrizzleDiaryRepository(transaction as never),
          );
          const list = async (
            query: Parameters<DiaryService["listDiaries"]>[0]["query"],
            userId = owner,
          ) => (await service.listDiaries({ userId, query })).diaries;

          assert.deepEqual(
            (await list({})).map(({ id }) => id),
            [exactId, partialId],
          );

          await transaction.insert(diaryEntries).values(
            Array.from({ length: 51 }, (_, index) =>
              record({
                id: randomUUID(),
                userId: owner,
                title: `Limit noise ${index}`,
                content: "Does not contain the target phrase.",
                date: "2026-07-08",
                tags: ["noise"],
                mood: "neutral",
              }),
            ),
          );
          assert.deepEqual(
            (await list({ q: "Japan private journal" }))
              .map(({ id }) => id),
            [exactId],
          );

          assert.deepEqual(
            (await list({ tag: "filter-test" })).map(({ id }) => id),
            [exactId],
          );
          assert.ok(!(await list({ tag: "test" })).some(({ id }) => id === exactId));
          assert.deepEqual(
            (await list({ tag: "filter" })).map(({ id }) => id),
            [partialId],
          );
          assert.deepEqual(
            (await list({
              q: "100% _complete_ \\",
              tag: "filter-test",
              mood: "happy",
              dateFrom: "2026-07-07",
              dateTo: "2026-07-07",
            })).map(({ id }) => id),
            [exactId],
          );
          assert.equal((await list({
            tag: "filter-test",
            mood: "calm",
          })).length, 0);

          throw new RollbackDiarySearchTest();
        }),
        RollbackDiarySearchTest,
      );
    } finally {
      await database.close();
    }
  },
);

test(
  "real Diary repository scopes lifecycle rows, orders archives, and records transactional events",
  { skip: !RUN_INTEGRATION },
  async () => {
    const database = createDatabase(process.env.DATABASE_URL!);
    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const owner = randomUUID();
          const other = randomUUID();
          const activeId = randomUUID();
          const archivedOlder = randomUUID();
          const archivedTieLow = "00000000-0000-4000-8000-000000000010";
          const archivedTieHigh = "00000000-0000-4000-8000-000000000020";
          const now = new Date("2026-07-29T08:00:00Z");
          await transaction.insert(users).values([
            {
              id: owner,
              email: `diary-life-${owner}@example.invalid`,
              displayName: "Diary lifecycle owner",
            },
            {
              id: other,
              email: `diary-life-${other}@example.invalid`,
              displayName: "Diary lifecycle other",
            },
          ]);
          const record = (
            id: string,
            userId: string,
            status: "active" | "archived",
            updatedAt: Date,
          ) => ({
            id,
            userId,
            title: `Diary ${id}`,
            content: "Lifecycle integration content",
            date: "2026-07-29",
            tags: [],
            source: "chatgpt_mcp" as const,
            status,
            idempotencyKey: `integration:${id}`,
            requestHash: createHash("sha256").update(id).digest("hex"),
            createdAt: now,
            updatedAt,
          });
          await transaction.insert(diaryEntries).values([
            record(activeId, owner, "active", now),
            record(
              archivedOlder,
              owner,
              "archived",
              new Date("2026-07-28T00:00:00Z"),
            ),
            record(archivedTieLow, owner, "archived", now),
            record(archivedTieHigh, owner, "archived", now),
            record(randomUUID(), other, "archived", now),
          ]);

          const repository = new DrizzleDiaryRepository(
            transaction as never,
          );
          assert.deepEqual(
            (await repository.findDiaryEntries(owner, 50)).map(({ id }) => id),
            [activeId],
          );
          const service = new DiaryService(repository);
          await assert.rejects(
            service.readDiary({ userId: owner, id: archivedTieHigh }),
            (error: unknown) =>
              error instanceof Error &&
              "code" in error &&
              error.code === "DIARY_NOT_FOUND",
          );
          assert.deepEqual(
            (await repository.findArchivedDiaries(owner, 2))
              .map(({ id }) => id),
            [archivedTieHigh, archivedTieLow],
          );
          assert.equal(
            await repository.findArchivedDiaryById(owner, activeId),
            null,
          );

          assert.equal(await repository.archiveDiary({
            id: activeId,
            userId: owner,
            actorType: "user",
            channel: "web",
          }), true);
          assert.equal(await repository.archiveDiary({
            id: activeId,
            userId: owner,
            actorType: "user",
            channel: "web",
          }), false);
          assert.equal(await repository.restoreDiary({
            id: activeId,
            userId: owner,
            actorType: "user",
            channel: "web",
          }), true);

          const events = await transaction
            .select({
              action: resourceLifecycleEvents.action,
              actorType: resourceLifecycleEvents.actorType,
              channel: resourceLifecycleEvents.channel,
              metadata: resourceLifecycleEvents.metadata,
            })
            .from(resourceLifecycleEvents)
            .where(
              and(
                eq(resourceLifecycleEvents.resourceType, "diary"),
                eq(resourceLifecycleEvents.resourceId, activeId),
              ),
            );
          assert.deepEqual(events, [
            {
              action: "archive",
              actorType: "user",
              channel: "web",
              metadata: {},
            },
            {
              action: "restore",
              actorType: "user",
              channel: "web",
              metadata: {},
            },
          ]);

          const rollbackId = randomUUID();
          await transaction.insert(diaryEntries).values(
            record(rollbackId, owner, "active", now),
          );
          const failingRepository = new DrizzleDiaryRepository(
            transaction as never,
            {
              async record() {
                throw new Error("audit unavailable");
              },
            },
          );
          await assert.rejects(
            failingRepository.archiveDiary({
              id: rollbackId,
              userId: owner,
              actorType: "user",
              channel: "web",
            }),
            /audit unavailable/,
          );
          const [rolledBack] = await transaction
            .select({ status: diaryEntries.status })
            .from(diaryEntries)
            .where(eq(diaryEntries.id, rollbackId));
          assert.equal(rolledBack?.status, "active");

          throw new RollbackDiaryLifecycleTest();
        }),
        RollbackDiaryLifecycleTest,
      );
    } finally {
      await database.close();
    }
  },
);
