import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
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
  nativeLiveTurnPreparations,
} from "./native-live-turn.js";
import {
  users,
} from "./users.js";
import {
  type ConversationRuntimeProvider,
} from "./conversation.js";

export type NativeLiveRuntimeEventType =
  | "session"
  | "text"
  | "partial_text"
  | "tool_use"
  | "tool_result"
  | "attachment"
  | "task"
  | "result"
  | "error"
  | "runtime";

export type NativeLiveRuntimeInteractionKind =
  | "permission"
  | "question";
export type NativeLiveRuntimeInteractionStatus =
  | "pending"
  | "resolved"
  | "cancelled";
export type NativeLiveRuntimeControlKind =
  | "mid_turn_input"
  | "interrupt";
export type NativeLiveRuntimeControlStatus =
  | "pending"
  | "reserved"
  | "applied"
  | "failed";

export const nativeLiveRuntimeEvents = pgTable(
  "native_live_runtime_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    prepareId: uuid("prepare_id").notNull(),
    sequence: integer("sequence").notNull(),
    eventType: varchar("event_type", { length: 32 })
      .$type<NativeLiveRuntimeEventType>()
      .notNull(),
    providerSessionId: text("provider_session_id"),
    payload: jsonb("payload").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.prepareId, table.userId],
      foreignColumns: [
        nativeLiveTurnPreparations.id,
        nativeLiveTurnPreparations.userId,
      ],
      name: "native_live_runtime_events_preparation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("native_live_runtime_events_prepare_sequence_uidx").on(
      table.userId,
      table.prepareId,
      table.sequence,
    ),
    index("native_live_runtime_events_prepare_sequence_idx").on(
      table.userId,
      table.prepareId,
      table.sequence,
    ),
    check(
      "native_live_runtime_events_sequence_positive",
      sql`${table.sequence} > 0`,
    ),
    check(
      "native_live_runtime_events_type_allowed",
      sql`${table.eventType} IN ('session', 'text', 'partial_text', 'tool_use', 'tool_result', 'attachment', 'task', 'result', 'error', 'runtime')`,
    ),
    check(
      "native_live_runtime_events_provider_session_not_blank",
      sql`${table.providerSessionId} IS NULL OR char_length(btrim(${table.providerSessionId})) > 0`,
    ),
    check(
      "native_live_runtime_events_payload_object",
      sql`${table.payload} IS NULL OR jsonb_typeof(${table.payload}) = 'object'`,
    ),
  ],
);

export const nativeLiveRuntimeInteractions = pgTable(
  "native_live_runtime_interactions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    prepareId: uuid("prepare_id").notNull(),
    listenerInstanceId: uuid("listener_instance_id").notNull(),
    kind: varchar("kind", { length: 32 })
      .$type<NativeLiveRuntimeInteractionKind>()
      .notNull(),
    request: jsonb("request").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 32 })
      .$type<NativeLiveRuntimeInteractionStatus>()
      .default("pending")
      .notNull(),
    response: jsonb("response").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.prepareId, table.userId],
      foreignColumns: [
        nativeLiveTurnPreparations.id,
        nativeLiveTurnPreparations.userId,
      ],
      name: "native_live_runtime_interactions_preparation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    index("native_live_runtime_interactions_turn_status_idx").on(
      table.userId,
      table.prepareId,
      table.status,
      table.createdAt,
      table.id,
    ),
    check(
      "native_live_runtime_interactions_kind_allowed",
      sql`${table.kind} IN ('permission', 'question')`,
    ),
    check(
      "native_live_runtime_interactions_request_object",
      sql`jsonb_typeof(${table.request}) = 'object' AND ${table.request} <> '{}'::jsonb`,
    ),
    check(
      "native_live_runtime_interactions_status_allowed",
      sql`${table.status} IN ('pending', 'resolved', 'cancelled')`,
    ),
    check(
      "native_live_runtime_interactions_response_object",
      sql`${table.response} IS NULL OR jsonb_typeof(${table.response}) = 'object'`,
    ),
    check(
      "native_live_runtime_interactions_state_consistency",
      sql`(${table.status} = 'pending'
          AND ${table.response} IS NULL
          AND ${table.resolvedAt} IS NULL
          AND ${table.cancelledAt} IS NULL)
        OR (${table.status} = 'resolved'
          AND ${table.response} IS NOT NULL
          AND ${table.resolvedAt} IS NOT NULL
          AND ${table.cancelledAt} IS NULL)
        OR (${table.status} = 'cancelled'
          AND ${table.response} IS NULL
          AND ${table.resolvedAt} IS NULL
          AND ${table.cancelledAt} IS NOT NULL)`,
    ),
  ],
);

export const nativeLiveRuntimeControls = pgTable(
  "native_live_runtime_controls",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    prepareId: uuid("prepare_id").notNull(),
    kind: varchar("kind", { length: 32 })
      .$type<NativeLiveRuntimeControlKind>()
      .notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 32 })
      .$type<NativeLiveRuntimeControlStatus>()
      .default("pending")
      .notNull(),
    reservedBy: uuid("reserved_by"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    receipt: jsonb("receipt").$type<Record<string, unknown> | null>(),
    failureCode: varchar("failure_code", { length: 64 }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.prepareId, table.userId],
      foreignColumns: [
        nativeLiveTurnPreparations.id,
        nativeLiveTurnPreparations.userId,
      ],
      name: "native_live_runtime_controls_preparation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    index("native_live_runtime_controls_queue_idx").on(
      table.userId,
      table.prepareId,
      table.status,
      table.createdAt,
      table.id,
    ),
    check(
      "native_live_runtime_controls_kind_allowed",
      sql`${table.kind} IN ('mid_turn_input', 'interrupt')`,
    ),
    check(
      "native_live_runtime_controls_payload_object",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    check(
      "native_live_runtime_controls_status_allowed",
      sql`${table.status} IN ('pending', 'reserved', 'applied', 'failed')`,
    ),
    check(
      "native_live_runtime_controls_receipt_object",
      sql`${table.receipt} IS NULL OR jsonb_typeof(${table.receipt}) = 'object'`,
    ),
    check(
      "native_live_runtime_controls_state_consistency",
      sql`(${table.status} = 'pending'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.receipt} IS NULL
          AND ${table.failureCode} IS NULL
          AND ${table.appliedAt} IS NULL)
        OR (${table.status} = 'reserved'
          AND ${table.reservedBy} IS NOT NULL
          AND ${table.reservedAt} IS NOT NULL
          AND ${table.receipt} IS NULL
          AND ${table.failureCode} IS NULL
          AND ${table.appliedAt} IS NULL)
        OR (${table.status} = 'applied'
          AND ${table.reservedBy} IS NOT NULL
          AND ${table.reservedAt} IS NOT NULL
          AND ${table.receipt} IS NOT NULL
          AND ${table.failureCode} IS NULL
          AND ${table.appliedAt} IS NOT NULL)
        OR (${table.status} = 'failed'
          AND ${table.reservedBy} IS NOT NULL
          AND ${table.reservedAt} IS NOT NULL
          AND ${table.receipt} IS NULL
          AND ${table.failureCode} IS NOT NULL
          AND ${table.appliedAt} IS NOT NULL)`,
    ),
  ],
);

export const nativeLiveRuntimeListenerLeases = pgTable(
  "native_live_runtime_listener_leases",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    dispatchTarget: varchar("dispatch_target", { length: 32 })
      .$type<ConversationRuntimeProvider>()
      .notNull(),
    listenerInstanceId: uuid("listener_instance_id").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true })
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.dispatchTarget] }),
    index("native_live_runtime_listener_leases_expiry_idx").on(
      table.leaseExpiresAt,
    ),
    check(
      "native_live_runtime_listener_leases_target_allowed",
      sql`${table.dispatchTarget} = 'claude_code'`,
    ),
  ],
);
