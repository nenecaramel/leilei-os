import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

export type NativeLiveSilenceWakeSlot =
  | "post_turn_idle"
  | "mid_idle"
  | "long_idle";

// Concern wakes share the epoch receipt ledger; each slot is one bounded,
// program-owned opportunity per unanswered user message.
export type NativeLiveConcernWakeSlot =
  | "concern_1"
  | "concern_2"
  | "concern_3";

// Recurring silence wakes, numbered per epoch (bounded by RECURRING_IDLE_LIMIT).
export type NativeLiveRecurringIdleSlot = `idle_${number}`;

export type NativeLiveWakeReceiptSlot =
  | NativeLiveSilenceWakeSlot
  | NativeLiveConcernWakeSlot
  | NativeLiveRecurringIdleSlot;

export const nativeLiveSilenceWakeReceipts = pgTable(
  "native_live_silence_wake_receipts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    epochId: uuid("epoch_id").notNull(),
    slot: varchar("slot", { length: 32 })
      .$type<NativeLiveWakeReceiptSlot>()
      .notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.epochId, table.slot],
    }),
    check(
      "native_live_silence_wake_receipts_slot_allowed",
      sql`${table.slot} IN ('post_turn_idle', 'mid_idle', 'long_idle', 'concern_1', 'concern_2', 'concern_3') OR ${table.slot} ~ '^idle_([1-9]|[1-5][0-9]|6[0-4])$'`,
    ),
  ],
);
