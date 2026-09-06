import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/database/schema.js";
import { healthDailySummaries, users } from "../src/database/schema.js";
import { DrizzleHealthRepository } from "../src/domains/health-v2/health-repository.js";

const run = process.env.RUN_HEALTH_V2_DATABASE_TEST === "1" && Boolean(process.env.DATABASE_URL);

class RollbackHealthTest extends Error {}

function createDatabase(url: string) {
  const client = postgres(url, { max: 4, prepare: false, ssl: false });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

test("Health repository atomically upserts and scopes reads by owner", { skip: !run }, async () => {
  const database = createDatabase(process.env.DATABASE_URL!);
  try {
    await assert.rejects(
      database.db.transaction(async (tx) => {
        const owner = randomUUID();
        const other = randomUUID();
        const date = "2026-08-12";
        const now = new Date("2026-08-12T08:00:00Z");
        await tx.insert(users).values([
          { id: owner, email: `health-${owner}@example.invalid`, displayName: "Health owner", status: "active", createdAt: now, updatedAt: now },
          { id: other, email: `health-${other}@example.invalid`, displayName: "Health other", status: "active", createdAt: now, updatedAt: now },
        ]);
        const repository = new DrizzleHealthRepository(tx as never);
        const first = await repository.upsertDaily(owner, {
          date, steps: 1000, menstruating: false, periodStartDate: null, cycleDay: null,
        });
        assert.equal(first.created, true);
        assert.equal(first.summary.steps, 1000);
        const createdAt = (await tx.select({ createdAt: healthDailySummaries.createdAt }).from(healthDailySummaries).where(eq(healthDailySummaries.id, (await tx.select({ id: healthDailySummaries.id }).from(healthDailySummaries).where(eq(healthDailySummaries.userId, owner)).limit(1))[0]!.id)).limit(1))[0]!.createdAt;
        const second = await repository.upsertDaily(owner, {
          date, steps: 2400, menstruating: true, periodStartDate: "2026-08-10", cycleDay: 3,
        });
        assert.equal(second.created, false);
        assert.equal(second.summary.steps, 2400);
        assert.equal(second.summary.menstruating, true);
        const row = await repository.readDay(owner, date);
        assert.ok(row);
        assert.equal(row.steps, 2400);
        assert.equal(row.periodStartDate, "2026-08-10");
        assert.equal(row.cycleDay, 3);
        assert.equal(row.updatedAt instanceof Date, true);
        assert.equal((await repository.readDay(other, date)), null);
        const range = await repository.readRange(owner, "2026-08-01", "2026-08-31");
        assert.deepEqual(range.map((item) => item.date), [date]);
        const before = await repository.readDay(owner, date);
        assert.ok(before);
        assert.ok(createdAt instanceof Date);
        assert.ok(before.updatedAt >= createdAt);
        const persistedCreatedAt = (
          await tx
            .select({ createdAt: healthDailySummaries.createdAt })
            .from(healthDailySummaries)
            .where(and(eq(healthDailySummaries.userId, owner), eq(healthDailySummaries.date, date)))
            .limit(1)
        )[0]?.createdAt;
        assert.deepEqual(persistedCreatedAt, createdAt);
        throw new RollbackHealthTest();
      }),
      RollbackHealthTest,
    );
  } finally {
    await database.close();
  }
});

test("Health repository does not write for a disabled user", { skip: !run }, async () => {
  const database = createDatabase(process.env.DATABASE_URL!);
  try {
    await assert.rejects(
      database.db.transaction(async (tx) => {
        const userId = randomUUID();
        const now = new Date("2026-08-12T08:00:00Z");
        await tx.insert(users).values({ id: userId, email: `health-disabled-${userId}@example.invalid`, displayName: "Disabled", status: "disabled", createdAt: now, updatedAt: now });
        const repository = new DrizzleHealthRepository(tx as never);
        await assert.rejects(() => repository.upsertDaily(userId, { date: "2026-08-12", steps: 1, menstruating: false, periodStartDate: null, cycleDay: null }));
        assert.equal((await tx.select().from(healthDailySummaries).where(eq(healthDailySummaries.userId, userId))).length, 0);
        throw new RollbackHealthTest();
      }),
      RollbackHealthTest,
    );
  } finally {
    await database.close();
  }
});

test("Health table constraints reject inconsistent cycle rows", { skip: !run }, async () => {
  const database = createDatabase(process.env.DATABASE_URL!);
  try {
    await assert.rejects(
      database.db.transaction(async (tx) => {
        const userId = randomUUID();
        const now = new Date("2026-08-12T08:00:00Z");
        await tx.insert(users).values({ id: userId, email: `health-constraint-${userId}@example.invalid`, displayName: "Constraint", status: "active", createdAt: now, updatedAt: now });
        await assert.rejects(() => tx.insert(healthDailySummaries).values({ userId, date: "2026-08-12", steps: 1, menstruating: false, periodStartDate: "2026-08-12", cycleDay: 2, createdAt: now, updatedAt: now }));
        throw new RollbackHealthTest();
      }),
      RollbackHealthTest,
    );
  } finally {
    await database.close();
  }
});
