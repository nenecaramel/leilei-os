import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
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
class RollbackDiaryDateReadTest extends Error {}

function createLocalDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10, prepare: false, ssl: false });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

test(
  "real Diary exact-date read returns every active row without the generic list limit",
  { skip: !RUN_INTEGRATION },
  async () => {
    const database = createLocalDatabase(process.env.DATABASE_URL!);
    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const userId = randomUUID();
          const now = new Date("2026-08-12T08:00:00Z");
          await transaction.insert(users).values({
            id: userId,
            email: `diary-date-${userId}@example.invalid`,
            displayName: "Diary date owner",
            status: "active",
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(diaryEntries).values(
            Array.from({ length: 121 }, (_, index) => ({
              id: randomUUID(),
              userId,
              title: `Exact ${index}`,
              content: "Body",
              date: "2026-08-12",
              tags: [],
              mood: null,
              source: "chatgpt_mcp" as const,
              idempotencyKey: `date-read-${userId}-${index}`,
              requestHash: createHash("sha256").update(`${userId}:${index}`).digest("hex"),
              author: index % 2 === 0 ? "L" : null,
              status: "active" as const,
              createdAt: new Date(now.getTime() + index),
              updatedAt: new Date(now.getTime() + index),
            })),
          );
          const service = new DiaryService(new DrizzleDiaryRepository(transaction as never));
          const result = await service.listDiariesByDate({ userId, date: "2026-08-12" });
          assert.equal(result.diaries.length, 121);
          assert.equal(new Set(result.diaries.map((row) => row.id)).size, 121);
          throw new RollbackDiaryDateReadTest();
        }),
        RollbackDiaryDateReadTest,
      );
    } finally {
      await database.close();
    }
  },
);

test(
  "real Diary repository applies exact tags, literal search, ownership, dates and AND filters before limit",
  { skip: !RUN_INTEGRATION },
  async () => {
    const database = createLocalDatabase(process.env.DATABASE_URL!);
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
            author?: "L" | "G" | "C" | null;
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

          const authorFixtureIds = [randomUUID(), randomUUID(), randomUUID()];
          await transaction.insert(diaryEntries).values([
            record({
              id: authorFixtureIds[0]!,
              userId: owner,
              title: "Diary L author",
              content: "Explicit L author fixture",
              date: "2026-07-08",
              tags: [],
              mood: "neutral",
              author: "L",
            }),
            record({
              id: authorFixtureIds[1]!,
              userId: owner,
              title: "Diary G author",
              content: "Explicit G author fixture",
              date: "2026-07-08",
              tags: [],
              mood: "neutral",
              author: "G",
            }),
            record({
              id: authorFixtureIds[2]!,
              userId: owner,
              title: "Diary null author",
              content: "Legacy null author fixture",
              date: "2026-07-08",
              tags: [],
              mood: "neutral",
              author: null,
            }),
          ]);
          assert.deepEqual(
            (await transaction.select({
              id: diaryEntries.id,
              author: diaryEntries.author,
            }).from(diaryEntries).where(inArray(diaryEntries.id, authorFixtureIds)))
              .sort((left, right) => left.id.localeCompare(right.id)),
            authorFixtureIds
              .map((id, index) => ({
                id,
                author: index === 0 ? "L" : index === 1 ? "G" : null,
              }))
              .sort((left, right) => left.id.localeCompare(right.id)),
          );

          const service = new DiaryService(
            new DrizzleDiaryRepository(transaction as never),
          );
          const list = async (
            query: Parameters<DiaryService["listDiaries"]>[0]["query"],
            userId = owner,
          ) => (await service.listDiaries({ userId, query })).diaries;

          const initialList = await list({});
          assert.equal(initialList.length, 5);
          assert.ok(initialList.some(({ id }) => id === exactId));
          assert.ok(initialList.some(({ id }) => id === partialId));

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
          const limited = await service.listDiaries({
            userId: owner,
            limit: 1,
          });
          assert.equal(limited.diaries.length, 1);
          assert.equal(limited.metadata.count, 56);

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
    const database = createLocalDatabase(process.env.DATABASE_URL!);
    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const owner = randomUUID();
          const other = randomUUID();
          const orderOwner = randomUUID();
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
            {
              id: orderOwner,
              email: `diary-order-${orderOwner}@example.invalid`,
              displayName: "Diary ordering owner",
            },
          ]);
          const record = (
            id: string,
            userId: string,
            status: "active" | "archived",
            overrides: {
              date?: string;
              createdAt?: Date;
              updatedAt?: Date;
            } = {},
          ) => ({
            id,
            userId,
            title: `Diary ${id}`,
            content: "Lifecycle integration content",
            date: overrides.date ?? "2026-07-29",
            tags: [],
            source: "chatgpt_mcp" as const,
            status,
            idempotencyKey: `integration:${id}`,
            requestHash: createHash("sha256").update(id).digest("hex"),
            createdAt: overrides.createdAt ?? now,
            updatedAt: overrides.updatedAt ?? now,
          });
          await transaction.insert(diaryEntries).values([
            record(activeId, owner, "active", {
              createdAt: new Date("2020-01-01T00:00:00Z"),
              updatedAt: new Date("2020-01-01T00:00:00Z"),
            }),
            record(
              archivedOlder,
              orderOwner,
              "active",
              {
                date: "2026-07-24",
                createdAt: new Date("2026-07-24T10:00:00Z"),
                updatedAt: new Date("2026-07-28T00:00:00Z"),
              },
            ),
            record(
              archivedTieLow,
              orderOwner,
              "active",
              {
                date: "2026-07-29",
                createdAt: new Date("2026-07-29T07:00:00Z"),
                updatedAt: new Date("2026-07-21T00:00:00Z"),
              },
            ),
            record(
              archivedTieHigh,
              orderOwner,
              "active",
              {
                date: "2026-07-29",
                createdAt: new Date("2026-07-29T09:00:00Z"),
                updatedAt: new Date("2026-07-20T00:00:00Z"),
              },
            ),
            record(
              randomUUID(),
              other,
              "archived",
              { date: "2026-08-01" },
            ),
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
          for (const id of [
            archivedTieHigh,
            archivedTieLow,
            archivedOlder,
          ]) {
            assert.equal(await repository.archiveDiary({
              id,
              userId: orderOwner,
              actorType: "user",
              channel: "web",
            }), true);
          }
          assert.deepEqual(
            (await repository.findArchivedDiaries(orderOwner, 3))
              .map(({ id }) => id),
            [archivedTieHigh, archivedTieLow, archivedOlder],
          );
          const archivedOrderingRows = await transaction
            .select({
              id: diaryEntries.id,
              updatedAt: diaryEntries.updatedAt,
            })
            .from(diaryEntries)
            .where(
              eq(diaryEntries.userId, orderOwner),
            );
          assert.deepEqual(
            new Map(
              archivedOrderingRows.map((row) => [
                row.id,
                row.updatedAt.toISOString(),
              ]),
            ),
            new Map([
              [archivedOlder, "2026-07-28T00:00:00.000Z"],
              [archivedTieLow, "2026-07-21T00:00:00.000Z"],
              [archivedTieHigh, "2026-07-20T00:00:00.000Z"],
            ]),
            "reverse archive order does not change content updated_at",
          );
          for (const id of [
            archivedTieHigh,
            archivedTieLow,
            archivedOlder,
          ]) {
            assert.equal(await repository.restoreDiary({
              id,
              userId: orderOwner,
              actorType: "user",
              channel: "web",
            }), true);
          }
          const restoredOrderingRows = await transaction
            .select({
              id: diaryEntries.id,
              updatedAt: diaryEntries.updatedAt,
            })
            .from(diaryEntries)
            .where(eq(diaryEntries.userId, orderOwner));
          assert.deepEqual(
            new Map(
              restoredOrderingRows.map((row) => [
                row.id,
                row.updatedAt.toISOString(),
              ]),
            ),
            new Map([
              [archivedOlder, "2026-07-28T00:00:00.000Z"],
              [archivedTieLow, "2026-07-21T00:00:00.000Z"],
              [archivedTieHigh, "2026-07-20T00:00:00.000Z"],
            ]),
            "restore also preserves content updated_at",
          );
          const orderingEvents = await transaction
            .select({
              resourceId: resourceLifecycleEvents.resourceId,
              action: resourceLifecycleEvents.action,
              actorType: resourceLifecycleEvents.actorType,
              channel: resourceLifecycleEvents.channel,
              metadata: resourceLifecycleEvents.metadata,
              createdAt: resourceLifecycleEvents.createdAt,
            })
            .from(resourceLifecycleEvents)
            .where(
              and(
                eq(resourceLifecycleEvents.resourceType, "diary"),
                eq(resourceLifecycleEvents.userId, orderOwner),
              ),
            );
          assert.equal(orderingEvents.length, 6);
          assert.ok(
            orderingEvents.every(
              ({ resourceId, createdAt }) =>
                createdAt.getTime() >
                new Map([
                  [archivedOlder, new Date("2026-07-28T00:00:00Z")],
                  [archivedTieLow, new Date("2026-07-21T00:00:00Z")],
                  [archivedTieHigh, new Date("2026-07-20T00:00:00Z")],
                ]).get(resourceId)!.getTime(),
            ),
            "Diary lifecycle created_at is independent from content updated_at",
          );
          assert.ok(
            orderingEvents.every(
              ({ actorType, channel, metadata }) =>
                actorType === "user" &&
                channel === "web" &&
              JSON.stringify(metadata) === "{}",
            ),
          );
          assert.deepEqual(
            orderingEvents
              .map(({ resourceId, action }) => `${resourceId}:${action}`)
              .sort(),
            [
              archivedOlder,
              archivedTieLow,
              archivedTieHigh,
            ].flatMap((id) => [
              `${id}:archive`,
              `${id}:restore`,
            ]).sort(),
          );
          assert.equal(
            await repository.findArchivedDiaryById(owner, activeId),
            null,
          );

          const [beforePartial] = await transaction
            .select({
              title: diaryEntries.title,
              content: diaryEntries.content,
              date: diaryEntries.date,
              tags: diaryEntries.tags,
              mood: diaryEntries.mood,
            })
            .from(diaryEntries)
            .where(eq(diaryEntries.id, activeId));
          const partialContent = await repository.updateDiary({
            id: activeId,
            userId: owner,
            content: "Content-only diary update",
          });
          assert.ok(partialContent);
          assert.deepEqual(
            {
              title: partialContent.title,
              content: partialContent.content,
              date: partialContent.date,
              tags: partialContent.tags,
              mood: partialContent.mood,
            },
            {
              ...beforePartial,
              content: "Content-only diary update",
            },
          );
          const partialCleared = await repository.updateDiary({
            id: activeId,
            userId: owner,
            tags: [],
            mood: null,
          });
          assert.ok(partialCleared);
          assert.deepEqual(partialCleared.tags, []);
          assert.equal(partialCleared.mood, null);

          const edited = await repository.updateDiary({
            id: activeId,
            userId: owner,
            title: "Edited lifecycle diary",
            content: "Edited lifecycle content",
            date: "2026-07-29",
            tags: ["edited"],
            mood: "calm",
          });
          assert.ok(edited);
          assert.notEqual(
            edited.updatedAt.toISOString(),
            "2020-01-01T00:00:00.000Z",
            "normal content editing changes updated_at",
          );
          const contentUpdatedAt = edited.updatedAt.toISOString();

          assert.equal(await repository.archiveDiary({
            id: activeId,
            userId: owner,
            actorType: "user",
            channel: "web",
          }), true);
          const [archivedEdited] = await transaction
            .select({ updatedAt: diaryEntries.updatedAt })
            .from(diaryEntries)
            .where(eq(diaryEntries.id, activeId));
          assert.equal(
            archivedEdited?.updatedAt.toISOString(),
            contentUpdatedAt,
            "archive preserves Diary content updated_at",
          );
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
          assert.equal(await repository.restoreDiary({
            id: activeId,
            userId: owner,
            actorType: "user",
            channel: "web",
          }), false);
          const [roundTripped] = await transaction
            .select()
            .from(diaryEntries)
            .where(eq(diaryEntries.id, activeId));
          assert.ok(roundTripped);
          assert.equal(roundTripped.status, "active");
          assert.equal(roundTripped.updatedAt.toISOString(), contentUpdatedAt);
          assert.equal(
            roundTripped.createdAt.toISOString(),
            "2020-01-01T00:00:00.000Z",
          );
          assert.deepEqual(
            {
              title: roundTripped.title,
              content: roundTripped.content,
              date: roundTripped.date,
              tags: roundTripped.tags,
              mood: roundTripped.mood,
            },
            {
              title: "Edited lifecycle diary",
              content: "Edited lifecycle content",
              date: "2026-07-29",
              tags: ["edited"],
              mood: "calm",
            },
            "archive and restore preserve all content fields",
          );

          const events = await transaction
            .select({
              action: resourceLifecycleEvents.action,
              actorType: resourceLifecycleEvents.actorType,
              channel: resourceLifecycleEvents.channel,
              metadata: resourceLifecycleEvents.metadata,
              createdAt: resourceLifecycleEvents.createdAt,
            })
            .from(resourceLifecycleEvents)
            .where(
              and(
                eq(resourceLifecycleEvents.resourceType, "diary"),
                eq(resourceLifecycleEvents.resourceId, activeId),
              ),
            );
          assert.equal(events.length, 2);
          assert.ok(
            events.every((event) => event.createdAt instanceof Date),
            "lifecycle events retain database timestamps",
          );
          assert.deepEqual(events.map(({ createdAt: _createdAt, ...event }) => event), [
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
            record(rollbackId, owner, "active"),
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
          const archiveRollbackEvents = await transaction
            .select({ id: resourceLifecycleEvents.id })
            .from(resourceLifecycleEvents)
            .where(
              and(
                eq(resourceLifecycleEvents.resourceType, "diary"),
                eq(resourceLifecycleEvents.resourceId, rollbackId),
              ),
            );
          assert.equal(archiveRollbackEvents.length, 0);

          const restoreRollbackId = randomUUID();
          await transaction.insert(diaryEntries).values(
            record(
              restoreRollbackId,
              owner,
              "archived",
            ),
          );
          const failingRestoreRepository = new DrizzleDiaryRepository(
            transaction as never,
            {
              async record() {
                throw new Error("audit unavailable");
              },
            },
          );
          await assert.rejects(
            failingRestoreRepository.restoreDiary({
              id: restoreRollbackId,
              userId: owner,
              actorType: "user",
              channel: "web",
            }),
            /audit unavailable/,
          );
          const [restoreRolledBack] = await transaction
            .select({ status: diaryEntries.status })
            .from(diaryEntries)
            .where(eq(diaryEntries.id, restoreRollbackId));
          assert.equal(restoreRolledBack?.status, "archived");
          const restoreEvents = await transaction
            .select({ id: resourceLifecycleEvents.id })
            .from(resourceLifecycleEvents)
            .where(
              and(
                eq(resourceLifecycleEvents.resourceType, "diary"),
                eq(resourceLifecycleEvents.resourceId, restoreRollbackId),
              ),
            );
          assert.equal(restoreEvents.length, 0);

          const crossUserActiveId = randomUUID();
          const crossUserArchivedId = randomUUID();
          await transaction.insert(diaryEntries).values([
            record(crossUserActiveId, other, "active"),
            record(crossUserArchivedId, other, "archived"),
          ]);
          assert.equal(await repository.archiveDiary({
            id: crossUserActiveId,
            userId: owner,
            actorType: "user",
            channel: "web",
          }), false);
          assert.equal(await repository.restoreDiary({
            id: crossUserArchivedId,
            userId: owner,
            actorType: "user",
            channel: "web",
          }), false);
          const crossUserRows = await transaction
            .select({
              id: diaryEntries.id,
              status: diaryEntries.status,
            })
            .from(diaryEntries)
            .where(
              and(
                eq(diaryEntries.id, crossUserActiveId),
              ),
            );
          const crossUserArchivedRows = await transaction
            .select({
              id: diaryEntries.id,
              status: diaryEntries.status,
            })
            .from(diaryEntries)
            .where(eq(diaryEntries.id, crossUserArchivedId));
          assert.equal(crossUserRows[0]?.status, "active");
          assert.equal(crossUserArchivedRows[0]?.status, "archived");
          const crossUserEvents = await transaction
            .select({ id: resourceLifecycleEvents.id })
            .from(resourceLifecycleEvents)
            .where(
              and(
                eq(resourceLifecycleEvents.resourceType, "diary"),
                eq(resourceLifecycleEvents.resourceId, crossUserActiveId),
              ),
            );
          const crossUserRestoreEvents = await transaction
            .select({ id: resourceLifecycleEvents.id })
            .from(resourceLifecycleEvents)
            .where(
              and(
                eq(resourceLifecycleEvents.resourceType, "diary"),
                eq(resourceLifecycleEvents.resourceId, crossUserArchivedId),
              ),
            );
          assert.equal(crossUserEvents.length, 0);
          assert.equal(crossUserRestoreEvents.length, 0);

          throw new RollbackDiaryLifecycleTest();
        }),
        RollbackDiaryLifecycleTest,
      );
    } finally {
      await database.close();
    }
  },
);
