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

// long_idle reaches the ledger as idle_N; older receipts carry it directly.
export type NativeLiveFixedWakeReceiptSlot =
  | "post_turn_idle"
  | "long_idle";

// Retired; only stored receipts still carry these.
export type NativeLiveRetiredWakeReceiptSlot =
  | "mid_idle"
  | "concern_1"
  | "concern_2"
  | "concern_3";

// Recurring silence wakes, numbered per epoch (bounded by RECURRING_IDLE_LIMIT).
export type NativeLiveRecurringIdleSlot = `idle_${number}`;

export type NativeLiveWakeReceiptSlot =
  | NativeLiveFixedWakeReceiptSlot
  | NativeLiveRetiredWakeReceiptSlot
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
