import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  users,
} from "./users.js";


export const toyCommandActionEnum = pgEnum("toy_command_action", [
  "set",
  "stop",
]);

export const toyCommandStatusEnum = pgEnum("toy_command_status", [
  "pending",
  "claimed",
  "completed",
  "failed",
  "expired",
]);

export const toyCommands = pgTable(
  "toy_commands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    action: toyCommandActionEnum("action").notNull(),
    percent: integer("percent"),
    durationSeconds: integer("duration_seconds").default(60),
    status: toyCommandStatusEnum("status").default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    error: varchar("error", { length: 500 }),
  },
  (table) => [
    index("toy_commands_claim_queue_idx").on(
      table.userId,
      table.status,
      table.expiresAt,
      table.action,
      table.createdAt,
      table.id,
    ),
    check(
      "toy_commands_action_allowed",
      sql`${table.action} IN ('set', 'stop')`,
    ),
    check(
      "toy_commands_status_allowed",
      sql`${table.status} IN ('pending', 'claimed', 'completed', 'failed', 'expired')`,
    ),
    check(
      "toy_commands_action_percent_consistency",
      sql`(${table.action} = 'set' AND ${table.percent} IS NOT NULL AND ${table.percent} BETWEEN 1 AND 50) OR (${table.action} = 'stop' AND ${table.percent} IS NULL)`,
    ),
    check(
      "toy_commands_error_length",
      sql`${table.error} IS NULL OR char_length(${table.error}) <= 500`,
    ),
    check(
      "toy_commands_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "toy_commands_duration_seconds_consistency",
      sql`(${table.action} = 'set' AND ${table.durationSeconds} BETWEEN 1 AND 1200) OR (${table.action} = 'stop' AND (${table.durationSeconds} IS NULL OR ${table.durationSeconds} = 60))`,
    ),
  ],
);
