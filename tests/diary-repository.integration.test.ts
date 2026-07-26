import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createDatabase } from "../src/database/client.js";
import { diaryEntries, users } from "../src/database/schema.js";
import {
  DrizzleDiaryRepository,
} from "../src/domains/diary/diary-repository.js";
import { DiaryService } from "../src/domains/diary/diary-service.js";

const RUN_INTEGRATION =
  process.env.RUN_DATABASE_INTEGRATION_TEST === "1" &&
  Boolean(process.env.DATABASE_URL);

class RollbackDiarySearchTest extends Error {}

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
