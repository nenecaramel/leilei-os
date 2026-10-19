import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { conversations } from "./conversation.js";
import { users } from "./users.js";

export type NativeLiveConcernStatus = "active" | "released";
export type NativeLiveConcernReleaseReason = "resolved" | "dropped";

// Short-lived things Claude chose to keep in mind. Permanent facts stay in
// Memory; these rows are bounded, expire on their own and are pruned.
export const nativeLiveConcerns = pgTable(
  "native_live_concerns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    // The user message whose turn recorded the concern. A Rewind that drops
    // it from the current path also silences the concern.
    originMessageId: uuid("origin_message_id").notNull(),
    content: varchar("content", { length: 300 }).notNull(),
    reason: varchar("reason", { length: 300 }),
    progress: varchar("progress", { length: 300 }),
    considerAt: timestamp("consider_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 16 })
      .$type<NativeLiveConcernStatus>()
      .default("active")
      .notNull(),
    releaseReason: varchar("release_reason", { length: 16 })
      .$type<NativeLiveConcernReleaseReason>(),
    revision: integer("revision").default(1).notNull(),
    // Program-owned execution record; never writable through the tool.
    wakeCount: integer("wake_count").default(0).notNull(),
    lastWokenAt: timestamp("last_woken_at", { withTimezone: true }),
    wokenConsiderAt: timestamp("woken_consider_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (table) => [
    index("native_live_concerns_user_status_consider_idx").on(
      table.userId,
      table.status,
      table.considerAt,
    ),
    index("native_live_concerns_conversation_idx").on(
      table.conversationId,
    ),
    check(
      "native_live_concerns_status_allowed",
      sql`${table.status} IN ('active', 'released')`,
    ),
    check(
      "native_live_concerns_release_consistency",
      sql`(
        ${table.status} = 'active'
        AND ${table.releaseReason} IS NULL
        AND ${table.releasedAt} IS NULL
      ) OR (
        ${table.status} = 'released'
        AND ${table.releaseReason} IN ('resolved', 'dropped')
        AND ${table.releasedAt} IS NOT NULL
      )`,
    ),
    check(
      "native_live_concerns_text_not_blank",
      sql`char_length(btrim(${table.content})) > 0`,
    ),
    check(
      "native_live_concerns_window_ordered",
      sql`${table.considerAt} < ${table.expiresAt}`,
    ),
    check(
      "native_live_concerns_counters_valid",
      sql`${table.revision} >= 1 AND ${table.wakeCount} >= 0`,
    ),
  ],
);
