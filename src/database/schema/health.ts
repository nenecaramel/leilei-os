import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  users,
} from "./users.js";


export const healthDailySummaries = pgTable(
  "health_daily_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    date: date("date", { mode: "string" }).notNull(),
    steps: integer("steps").notNull(),
    menstruating: boolean("menstruating").notNull(),
    periodStartDate: date("period_start_date", { mode: "string" }),
    cycleDay: integer("cycle_day"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("health_daily_summaries_user_date_uidx").on(
      table.userId,
      table.date,
    ),
    check("health_daily_summaries_steps_nonnegative", sql`${table.steps} >= 0`),
    check(
      "health_daily_summaries_cycle_day_positive",
      sql`${table.cycleDay} IS NULL OR ${table.cycleDay} >= 1`,
    ),
    check(
      "health_daily_summaries_cycle_pair",
      sql`(${table.periodStartDate} IS NULL) = (${table.cycleDay} IS NULL)`,
    ),
    check(
      "health_daily_summaries_period_not_future",
      sql`${table.periodStartDate} IS NULL OR ${table.periodStartDate} <= ${table.date}`,
    ),
    check(
      "health_daily_summaries_cycle_consistent",
      sql`${table.periodStartDate} IS NULL OR ${table.cycleDay} = (${table.date} - ${table.periodStartDate}) + 1`,
    ),
  ],
);
