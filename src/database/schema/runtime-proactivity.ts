import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  users,
} from "./users.js";
import {
  conversations,
  conversationMessages,
} from "./conversation.js";

export type RuntimeProactivityWakeStatus =
  | "created"
  | "waiting_model"
  | "decided";
export type RuntimeEffectStatus =
  | "pending"
  | "reserved"
  | "dispatching"
  | "observed"
  | "failed"
  | "unknown";

export const runtimeProactivityWakes = pgTable(
  "runtime_proactivity_wakes",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    subjectId: text("subject_id").notNull(),
    gate: jsonb("gate")
      .$type<Record<string, unknown>>()
      .notNull(),
    contactTarget: text("contact_target"),
    contextSnapshot: jsonb("context_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    status: varchar("status", { length: 32 })
      .$type<RuntimeProactivityWakeStatus>()
      .default("created")
      .notNull(),
    modelTaskId: uuid("model_task_id"),
    decision: jsonb("decision")
      .$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    unique("runtime_proactivity_wakes_id_user_unique").on(
      table.id,
      table.userId,
    ),
    index("runtime_proactivity_wakes_user_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index("runtime_proactivity_wakes_subject_created_idx").on(
      table.userId,
      table.subjectId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check(
      "runtime_proactivity_wakes_subject_not_blank",
      sql`char_length(btrim(${table.subjectId})) > 0`,
    ),
    check(
      "runtime_proactivity_wakes_gate_object",
      sql`jsonb_typeof(${table.gate}) = 'object'`,
    ),
    check(
      "runtime_proactivity_wakes_context_object",
      sql`jsonb_typeof(${table.contextSnapshot}) = 'object'`,
    ),
    check(
      "runtime_proactivity_wakes_target_not_blank",
      sql`${table.contactTarget} IS NULL
        OR char_length(btrim(${table.contactTarget})) > 0`,
    ),
    check(
      "runtime_proactivity_wakes_status_allowed",
      sql`${table.status} IN ('created', 'waiting_model', 'decided')`,
    ),
    check(
      "runtime_proactivity_wakes_state_consistency",
      sql`(${table.status} = 'created'
          AND ${table.modelTaskId} IS NULL
          AND ${table.decision} IS NULL
          AND ${table.decidedAt} IS NULL)
        OR (${table.status} = 'waiting_model'
          AND ${table.modelTaskId} IS NOT NULL
          AND ${table.decision} IS NULL
          AND ${table.decidedAt} IS NULL)
        OR (${table.status} = 'decided'
          AND ${table.decision} IS NOT NULL
          AND jsonb_typeof(${table.decision}) = 'object'
          AND ${table.decidedAt} IS NOT NULL)`,
    ),
  ],
);

export const runtimeEffects = pgTable(
  "runtime_effects",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    subjectId: text("subject_id").notNull(),
    sourceWakeId: uuid("source_wake_id").notNull(),
    decisionId: text("decision_id").notNull(),
    idempotencyKey: varchar("idempotency_key", {
      length: 64,
    }).notNull(),
    effectType: varchar("effect_type", { length: 64 })
      .notNull(),
    target: text("target").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    payloadHash: varchar("payload_hash", {
      length: 64,
    }).notNull(),
    status: varchar("status", { length: 32 })
      .$type<RuntimeEffectStatus>()
      .default("pending")
      .notNull(),
    attempt: integer("attempt").default(0).notNull(),
    retryable: boolean("retryable").default(true).notNull(),
    reservedBy: uuid("reserved_by"),
    reservedAt: timestamp("reserved_at", {
      withTimezone: true,
    }),
    reservationExpiresAt: timestamp("reservation_expires_at", {
      withTimezone: true,
    }),
    dispatchStartedAt: timestamp("dispatch_started_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
    }),
    failureCode: varchar("failure_code", { length: 128 }),
  },
  (table) => [
    unique("runtime_effects_id_user_unique").on(
      table.id,
      table.userId,
    ),
    foreignKey({
      columns: [table.sourceWakeId, table.userId],
      foreignColumns: [
        runtimeProactivityWakes.id,
        runtimeProactivityWakes.userId,
      ],
      name: "runtime_effects_wake_user_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    uniqueIndex("runtime_effects_user_idempotency_uidx").on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex("runtime_effects_source_wake_uidx").on(
      table.sourceWakeId,
    ),
    index("runtime_effects_user_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt,
      table.id,
    ),
    check(
      "runtime_effects_subject_not_blank",
      sql`char_length(btrim(${table.subjectId})) > 0`,
    ),
    check(
      "runtime_effects_decision_not_blank",
      sql`char_length(btrim(${table.decisionId})) > 0`,
    ),
    check(
      "runtime_effects_idempotency_format",
      sql`${table.idempotencyKey} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "runtime_effects_type_allowed",
      sql`${table.effectType} = 'message_send'`,
    ),
    check(
      "runtime_effects_target_not_blank",
      sql`char_length(btrim(${table.target})) > 0`,
    ),
    check(
      "runtime_effects_payload_object",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    check(
      "runtime_effects_payload_hash_format",
      sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "runtime_effects_status_allowed",
      sql`${table.status} IN ('pending', 'reserved', 'dispatching', 'observed', 'failed', 'unknown')`,
    ),
    check(
      "runtime_effects_attempt_nonnegative",
      sql`${table.attempt} >= 0`,
    ),
    check(
      "runtime_effects_state_consistency",
      sql`(${table.status} = 'pending'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.dispatchStartedAt} IS NULL
          AND ${table.observedAt} IS NULL
          AND ${table.failureCode} IS NULL
          AND ${table.retryable} = true)
        OR (${table.status} = 'reserved'
          AND ${table.reservedBy} IS NOT NULL
          AND ${table.reservedAt} IS NOT NULL
          AND ${table.reservationExpiresAt} IS NOT NULL
          AND ${table.dispatchStartedAt} IS NULL
          AND ${table.observedAt} IS NULL
          AND ${table.failureCode} IS NULL
          AND ${table.retryable} = true)
        OR (${table.status} = 'dispatching'
          AND ${table.reservedBy} IS NOT NULL
          AND ${table.reservedAt} IS NOT NULL
          AND ${table.reservationExpiresAt} IS NOT NULL
          AND ${table.dispatchStartedAt} IS NOT NULL
          AND ${table.observedAt} IS NULL
          AND ${table.failureCode} IS NULL
          AND ${table.retryable} = true
          AND ${table.attempt} > 0)
        OR (${table.status} = 'observed'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.dispatchStartedAt} IS NOT NULL
          AND ${table.observedAt} IS NOT NULL
          AND ${table.failureCode} IS NULL
          AND ${table.retryable} = false
          AND ${table.attempt} > 0)
        OR (${table.status} = 'failed'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.dispatchStartedAt} IS NOT NULL
          AND ${table.observedAt} IS NULL
          AND ${table.failureCode} IS NOT NULL
          AND char_length(btrim(${table.failureCode})) > 0
          AND ${table.attempt} > 0)
        OR (${table.status} = 'unknown'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.dispatchStartedAt} IS NOT NULL
          AND ${table.observedAt} IS NULL
          AND ${table.failureCode} IS NOT NULL
          AND char_length(btrim(${table.failureCode})) > 0
          AND ${table.retryable} = false
          AND ${table.attempt} > 0)`,
    ),
  ],
);

export const runtimeEffectMessageDeliveries = pgTable(
  "runtime_effect_message_deliveries",
  {
    effectId: uuid("effect_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    messageId: uuid("message_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.effectId, table.userId],
      foreignColumns: [
        runtimeEffects.id,
        runtimeEffects.userId,
      ],
      name: "runtime_effect_message_deliveries_effect_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [
        conversations.id,
        conversations.userId,
      ],
      name: "runtime_effect_message_deliveries_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [
        table.messageId,
        table.conversationId,
        table.userId,
      ],
      foreignColumns: [
        conversationMessages.id,
        conversationMessages.conversationId,
        conversationMessages.userId,
      ],
      name: "runtime_effect_message_deliveries_message_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex(
      "runtime_effect_message_deliveries_message_uidx",
    ).on(table.messageId),
    index(
      "runtime_effect_message_deliveries_user_created_idx",
    ).on(table.userId, table.createdAt, table.effectId),
  ],
);
