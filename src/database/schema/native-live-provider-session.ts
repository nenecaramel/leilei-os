import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  users,
} from "./users.js";
import {
  type ConversationRuntimeProvider,
} from "./conversation.js";

export type NativeLiveProviderSessionCleanupStatus =
  | "pending"
  | "reserved"
  | "completed"
  | "failed";

export const nativeLiveProviderSessionEntries = pgTable(
  "native_live_provider_session_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: uuid("workspace_id").notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    subpath: text("subpath").default("").notNull(),
    appendBatchId: uuid("append_batch_id").notNull(),
    appendOrdinal: integer("append_ordinal").notNull(),
    entry: jsonb("entry").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("native_live_provider_session_entries_load_idx").on(
      table.userId,
      table.workspaceId,
      table.providerSessionId,
      table.subpath,
      table.id,
    ),
    index("native_live_provider_session_entries_sessions_idx").on(
      table.userId,
      table.workspaceId,
      table.subpath,
      table.createdAt.desc(),
      table.providerSessionId,
    ),
    uniqueIndex("native_live_provider_session_entries_batch_ordinal_uidx").on(
      table.userId,
      table.workspaceId,
      table.providerSessionId,
      table.subpath,
      table.appendBatchId,
      table.appendOrdinal,
    ),
    check(
      "native_live_provider_session_entries_session_not_blank",
      sql`char_length(btrim(${table.providerSessionId})) > 0`,
    ),
    check(
      "native_live_provider_session_entries_session_length",
      sql`char_length(${table.providerSessionId}) <= 256`,
    ),
    check(
      "native_live_provider_session_entries_subpath_length",
      sql`char_length(${table.subpath}) <= 2000`,
    ),
    check(
      "native_live_provider_session_entries_append_ordinal_nonnegative",
      sql`${table.appendOrdinal} >= 0`,
    ),
    check(
      "native_live_provider_session_entries_entry_object",
      sql`jsonb_typeof(${table.entry}) = 'object'`,
    ),
  ],
);

export const nativeLiveProviderSessionStoreStatus = pgTable(
  "native_live_provider_session_store_status",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: uuid("workspace_id").notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    state: varchar("state", { length: 16 })
      .$type<"complete" | "incomplete">()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.userId,
        table.workspaceId,
        table.providerSessionId,
      ],
      name: "native_live_provider_session_store_status_pk",
    }),
    index("native_live_provider_session_store_status_state_idx").on(
      table.userId,
      table.state,
      table.updatedAt,
    ),
    check(
      "native_live_provider_session_store_status_session_not_blank",
      sql`char_length(btrim(${table.providerSessionId})) > 0`,
    ),
    check(
      "native_live_provider_session_store_status_session_length",
      sql`char_length(${table.providerSessionId}) <= 256`,
    ),
    check(
      "native_live_provider_session_store_status_state_allowed",
      sql`${table.state} IN ('complete', 'incomplete')`,
    ),
  ],
);

export const nativeLiveProviderSessionCleanups = pgTable(
  "native_live_provider_session_cleanups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    provider: varchar("provider", { length: 32 })
      .$type<ConversationRuntimeProvider>()
      .notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    workspaceId: uuid("workspace_id"),
    effectiveWorkspaceRoot: text("effective_workspace_root"),
    status: varchar("status", { length: 32 })
      .$type<NativeLiveProviderSessionCleanupStatus>()
      .default("pending")
      .notNull(),
    attempt: integer("attempt").default(0).notNull(),
    reservedBy: uuid("reserved_by"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    reservationExpiresAt: timestamp("reservation_expires_at", {
      withTimezone: true,
    }),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex(
      "native_live_provider_session_cleanups_user_session_uidx",
    ).on(
      table.userId,
      table.provider,
      table.providerSessionId,
    ),
    index(
      "native_live_provider_session_cleanups_queue_idx",
    ).on(
      table.userId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index(
      "native_live_provider_session_cleanups_workspace_idx",
    ).on(
      table.userId,
      table.workspaceId,
      table.createdAt,
      table.id,
    ),
    check(
      "native_live_provider_session_cleanups_provider_allowed",
      sql`${table.provider} = 'claude_code'`,
    ),
    check(
      "native_live_provider_session_cleanups_session_not_blank",
      sql`char_length(btrim(${table.providerSessionId})) > 0`,
    ),
    check(
      "native_live_provider_session_cleanups_workspace_root_not_blank",
      sql`${table.effectiveWorkspaceRoot} IS NULL OR char_length(btrim(${table.effectiveWorkspaceRoot})) > 0`,
    ),
    check(
      "native_live_provider_session_cleanups_attempt_bounds",
      sql`${table.attempt} BETWEEN 0 AND 5`,
    ),
    check(
      "native_live_provider_session_cleanups_status_allowed",
      sql`${table.status} IN ('pending', 'reserved', 'completed', 'failed')`,
    ),
    check(
      "native_live_provider_session_cleanups_state_consistency",
      sql`(
          ${table.status} = 'pending'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.completedAt} IS NULL
        ) OR (
          ${table.status} = 'reserved'
          AND ${table.reservedBy} IS NOT NULL
          AND ${table.reservedAt} IS NOT NULL
          AND ${table.reservationExpiresAt} IS NOT NULL
          AND ${table.completedAt} IS NULL
        ) OR (
          ${table.status} = 'completed'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.lastErrorCode} IS NULL
          AND ${table.completedAt} IS NOT NULL
        ) OR (
          ${table.status} = 'failed'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.lastErrorCode} IS NOT NULL
          AND ${table.completedAt} IS NOT NULL
        )`,
    ),
  ],
);
