import { desc, eq } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { healthRecords, users } from "../../database/schema.js";

export type HealthRecord = {
  id: string;
  date: string;
  steps: number | null;
  periodStartDate: string | null;
  cycleDay: number | null;
};

export type UpsertHealthInput = {
  userId: string;
  date: string;
  steps?: number | null;
  periodStartDate?: string | null;
  cycleDay?: number | null;
};
export type HealthUserRecord = { status: "active" | "disabled" };

type Database = ReturnType<typeof createDatabase>["db"];

export interface HealthRepository {
  findUserById(userId: string): Promise<HealthUserRecord | null>;
  upsertHealth(input: UpsertHealthInput): Promise<HealthRecord>;
  getLatestHealth(userId: string): Promise<HealthRecord | null>;
}

export class DrizzleHealthRepository implements HealthRepository {
  constructor(private readonly db: Database) {}

  async findUserById(userId: string): Promise<HealthUserRecord | null> {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user ?? null;
  }

  async upsertHealth(input: UpsertHealthInput): Promise<HealthRecord> {
    const [record] = await this.db
      .insert(healthRecords)
      .values({
        userId: input.userId,
        date: input.date,
        steps: input.steps ?? null,
        periodStartDate: input.periodStartDate ?? null,
        cycleDay: input.cycleDay ?? null,
      })
      .returning({
        id: healthRecords.id,
        date: healthRecords.date,
        steps: healthRecords.steps,
        periodStartDate: healthRecords.periodStartDate,
        cycleDay: healthRecords.cycleDay,
      });

      if (!record) {
        throw new Error("Failed to create health record.");
      }
      
      return record;
  }

  async getLatestHealth(userId: string): Promise<HealthRecord | null> {
    const [record] = await this.db
      .select({
        id: healthRecords.id,
        date: healthRecords.date,
        steps: healthRecords.steps,
        periodStartDate: healthRecords.periodStartDate,
        cycleDay: healthRecords.cycleDay,
      })
      .from(healthRecords)
      .where(eq(healthRecords.userId, userId))
      .orderBy(desc(healthRecords.date))
      .limit(1);

    return record ?? null;
  }
}
