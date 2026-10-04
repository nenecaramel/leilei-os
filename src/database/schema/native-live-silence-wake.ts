import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export type NativeLiveSilenceWakeSlot =
  | "post_turn_idle"
  | "long_idle";

export const nativeLiveSilenceWakeReceipts = pgTable(
  "native_live_silence_wake_receipts",
  {
    userId: uuid("user_id").notNull(),
    epochId: uuid("epoch_id").notNull(),
    slot: varchar("slot", { length: 32 })
      .$type<NativeLiveSilenceWakeSlot>()
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
      sql`${table.slot} IN ('post_turn_idle', 'long_idle')`,
    ),
  ],
);
