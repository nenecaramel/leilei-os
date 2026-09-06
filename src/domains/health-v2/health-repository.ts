import { and, eq, gte, lte } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { healthDailySummaries, users } from "../../database/schema.js";
import { requireActiveUserInTransaction } from "../require-active-user-transaction.js";
import type {
  HealthDailySummary,
  HealthRepository,
  HealthSyncResult,
  NormalizedHealthSync,
} from "./health-types.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function toSummary(row: typeof healthDailySummaries.$inferSelect): HealthDailySummary {
  return {
    date: row.date,
    steps: row.steps,
    menstruating: row.menstruating,
    periodStartDate: row.periodStartDate,
    cycleDay: row.cycleDay,
    updatedAt: row.updatedAt,
  };
}

async function readById(transaction: Transaction, userId: string, id: string) {
  const [row] = await transaction
    .select()
    .from(healthDailySummaries)
    .where(and(eq(healthDailySummaries.id, id), eq(healthDailySummaries.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Health summary disappeared during mutation.");
  return toSummary(row);
}

export class DrizzleHealthRepository implements HealthRepository {
  constructor(private readonly db: Database | Transaction) {}

  async findUserById(userId: string) {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user ?? null;
  }

  async upsertDaily(userId: string, summary: NormalizedHealthSync): Promise<HealthSyncResult> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, userId);
      const [inserted] = await transaction
        .insert(healthDailySummaries)
        .values({ userId, ...summary })
        .onConflictDoNothing({ target: [healthDailySummaries.userId, healthDailySummaries.date] })
        .returning({ id: healthDailySummaries.id });
      if (inserted) {
        return { created: true, summary: await readById(transaction, userId, inserted.id) };
      }
      const [updated] = await transaction
        .update(healthDailySummaries)
        .set({
          steps: summary.steps,
          menstruating: summary.menstruating,
          periodStartDate: summary.periodStartDate,
          cycleDay: summary.cycleDay,
          updatedAt: new Date(),
        })
        .where(and(eq(healthDailySummaries.userId, userId), eq(healthDailySummaries.date, summary.date)))
        .returning();
      if (!updated) throw new Error("Health summary disappeared during mutation.");
      return { created: false, summary: toSummary(updated) };
    });
  }

  async readDay(userId: string, date: string): Promise<HealthDailySummary | null> {
    const [row] = await this.db
      .select()
      .from(healthDailySummaries)
      .where(and(eq(healthDailySummaries.userId, userId), eq(healthDailySummaries.date, date)))
      .limit(1);
    return row ? toSummary(row) : null;
  }

  async readRange(userId: string, dateFrom: string, dateTo: string): Promise<HealthDailySummary[]> {
    const rows = await this.db
      .select()
      .from(healthDailySummaries)
      .where(and(
        eq(healthDailySummaries.userId, userId),
        gte(healthDailySummaries.date, dateFrom),
        lte(healthDailySummaries.date, dateTo),
      ))
      .orderBy(healthDailySummaries.date);
    return rows.map(toSummary);
  }
}
