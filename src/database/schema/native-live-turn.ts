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
  conversations,
  conversationMessages,
} from "./conversation.js";

export type NativeLiveTurnOperation = "send" | "retry" | "edit" | "wake";
export type NativeLiveTurnRuntimeMode = "new" | "fork";
export type NativeLiveTurnPreparationStatus =
  | "prepared"
  | "finalized_success"
  | "finalized_failure";
export type NativeLiveTurnDispatchStatus =
  | "staged"
  | "pending"
  | "reserved"
  | "executing"
  | "delivery_unknown"
  | "completed"
  | "rejected";
export type NativeLiveMindFollowUpStatus =
  | "pending"
  | "processing"
  | "completed"
  | "quarantined";

export const nativeLiveTurnPreparations = pgTable(
  "native_live_turn_preparations",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    requestId: uuid("request_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    operation: varchar("operation", { length: 16 })
      .$type<NativeLiveTurnOperation>()
      .notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    canonicalUserMessageId: uuid("canonical_user_message_id"),
    replacementTargetUserMessageId: uuid("replacement_target_user_message_id"),
    wakeContext: jsonb("wake_context").$type<Record<string, unknown> | null>(),
    runtimeMode: varchar("runtime_mode", { length: 16 })
      .$type<NativeLiveTurnRuntimeMode>()
      .notNull(),
    parentProviderSessionId: text("parent_provider_session_id"),
    expectedWorkingDirectory: text("expected_working_directory"),
    executionSelection: jsonb("execution_selection").$type<Record<string, unknown> | null>(),
    attachments: jsonb("attachments")
      .$type<Array<Record<string, unknown>>>()
      .default([])
      .notNull(),
    prompt: text("prompt").notNull(),
    mindPrepared: boolean("mind_prepared").default(false).notNull(),
    status: varchar("status", { length: 32 })
      .$type<NativeLiveTurnPreparationStatus>()
      .default("prepared")
      .notNull(),
    resultHash: varchar("result_hash", { length: 64 }),
    providerSessionId: text("provider_session_id"),
    runtimeMetadata: jsonb("runtime_metadata")
      .$type<Record<string, unknown> | null>(),
    assistantMessageId: uuid("assistant_message_id"),
    failureCode: varchar("failure_code", { length: 64 }),
    dispatchStatus: varchar("dispatch_status", { length: 32 })
      .$type<NativeLiveTurnDispatchStatus>()
      .default("staged")
      .notNull(),
    reservedBy: uuid("reserved_by"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    reservationExpiresAt: timestamp("reservation_expires_at", {
      withTimezone: true,
    }),
    executionStartedAt: timestamp("execution_started_at", {
      withTimezone: true,
    }),
    deliveryUnknownAt: timestamp("delivery_unknown_at", {
      withTimezone: true,
    }),
    dispatchErrorCode: varchar("dispatch_error_code", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "native_live_turn_preparations_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [
        table.canonicalUserMessageId,
        table.conversationId,
        table.userId,
      ],
      foreignColumns: [
        conversationMessages.id,
        conversationMessages.conversationId,
        conversationMessages.userId,
      ],
      name: "native_live_turn_preparations_user_message_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [
        table.assistantMessageId,
        table.conversationId,
        table.userId,
      ],
      foreignColumns: [
        conversationMessages.id,
        conversationMessages.conversationId,
        conversationMessages.userId,
      ],
      name: "native_live_turn_preparations_assistant_message_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("native_live_turn_preparations_user_request_uidx").on(
      table.userId,
      table.requestId,
    ),
    unique("native_live_turn_preparations_id_user_unique").on(
      table.id,
      table.userId,
    ),
    index("native_live_turn_preparations_user_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index("native_live_turn_preparations_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
      table.id,
    ),
    index("native_live_turn_preparations_dispatch_queue_idx").on(
      table.userId,
      table.dispatchStatus,
      table.createdAt,
      table.id,
    ),
    check(
      "native_live_turn_preparations_operation_allowed",
      sql`${table.operation} IN ('send', 'retry', 'edit', 'wake')`,
    ),
    check(
      "native_live_turn_preparations_wake_consistency",
      sql`(
        ${table.operation} = 'wake'
        AND ${table.canonicalUserMessageId} IS NULL
        AND ${table.replacementTargetUserMessageId} IS NULL
        AND ${table.wakeContext} IS NOT NULL
        AND jsonb_typeof(${table.wakeContext}) = 'object'
      ) OR (
        ${table.operation} <> 'wake'
        AND ${table.canonicalUserMessageId} IS NOT NULL
        AND ${table.wakeContext} IS NULL
      )`,
    ),
    check(
      "native_live_turn_preparations_runtime_mode_allowed",
      sql`${table.runtimeMode} IN ('new', 'fork')`,
    ),
    check(
      "native_live_turn_preparations_runtime_parent_consistency",
      sql`(${table.runtimeMode} = 'new' AND ${table.parentProviderSessionId} IS NULL)
        OR (${table.runtimeMode} = 'fork' AND ${table.parentProviderSessionId} IS NOT NULL AND char_length(btrim(${table.parentProviderSessionId})) > 0)`,
    ),
    check(
      "native_live_turn_preparations_execution_selection_object",
      sql`${table.executionSelection} IS NULL OR jsonb_typeof(${table.executionSelection}) = \'object\'`,
    ),
    check(
      "native_live_turn_preparations_working_directory_not_blank",
      sql`${table.expectedWorkingDirectory} IS NULL OR char_length(btrim(${table.expectedWorkingDirectory})) > 0`,
    ),
    check(
      "native_live_turn_preparations_attachments_array",
      sql`jsonb_typeof(${table.attachments}) = 'array'`,
    ),
    check(
      "native_live_turn_preparations_request_hash_format",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "native_live_turn_preparations_prompt_not_blank",
      sql`char_length(btrim(${table.prompt})) > 0`,
    ),
    check(
      "native_live_turn_preparations_status_allowed",
      sql`${table.status} IN ('prepared', 'finalized_success', 'finalized_failure')`,
    ),
    check(
      "native_live_turn_preparations_dispatch_status_allowed",
      sql`${table.dispatchStatus} IN ('staged', 'pending', 'reserved', 'executing', 'delivery_unknown', 'completed', 'rejected')`,
    ),
    check(
      "native_live_turn_preparations_dispatch_reservation_consistency",
      sql`(${table.dispatchStatus} IN ('staged', 'pending', 'rejected')
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.executionStartedAt} IS NULL)
        OR (${table.dispatchStatus} = 'reserved'
          AND ${table.reservedBy} IS NOT NULL
          AND ${table.reservedAt} IS NOT NULL
          AND ${table.reservationExpiresAt} IS NOT NULL
          AND ${table.executionStartedAt} IS NULL)
        OR (${table.dispatchStatus} IN ('executing', 'delivery_unknown', 'completed')
          AND ${table.reservedBy} IS NOT NULL
          AND ${table.reservedAt} IS NOT NULL
          AND ${table.reservationExpiresAt} IS NOT NULL
          AND ${table.executionStartedAt} IS NOT NULL)`,
    ),
    check(
      "native_live_turn_preparations_result_hash_format",
      sql`${table.resultHash} IS NULL OR ${table.resultHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "native_live_turn_preparations_runtime_metadata_object",
      sql`${table.runtimeMetadata} IS NULL OR jsonb_typeof(${table.runtimeMetadata}) = 'object'`,
    ),
    check(
      "native_live_turn_preparations_result_consistency",
      sql`(${table.status} = 'prepared'
          AND ${table.resultHash} IS NULL
          AND ${table.providerSessionId} IS NULL
          AND ${table.assistantMessageId} IS NULL
          AND ${table.failureCode} IS NULL
          AND ${table.finalizedAt} IS NULL)
        OR (${table.status} = 'finalized_success'
          AND ${table.resultHash} IS NOT NULL
          AND ${table.providerSessionId} IS NOT NULL
          AND char_length(btrim(${table.providerSessionId})) > 0
          AND ${table.assistantMessageId} IS NOT NULL
          AND ${table.failureCode} IS NULL
          AND ${table.finalizedAt} IS NOT NULL)
        OR (${table.status} = 'finalized_failure'
          AND ${table.resultHash} IS NOT NULL
          AND ${table.providerSessionId} IS NULL
          AND ${table.assistantMessageId} IS NULL
          AND ${table.failureCode} IS NOT NULL
          AND char_length(btrim(${table.failureCode})) > 0
          AND ${table.finalizedAt} IS NOT NULL)`,
    ),
  ],
);

export const nativeLiveMindFollowUps = pgTable(
  "native_live_mind_followups",
  {
    prepareId: uuid("prepare_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    assistantMessageId: uuid("assistant_message_id").notNull(),
    operation: varchar("operation", { length: 16 })
      .$type<NativeLiveTurnOperation>()
      .notNull(),
    intents: jsonb("intents")
      .$type<Record<string, unknown>[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    actions: jsonb("actions")
      .$type<Record<string, unknown>[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    receipts: jsonb("receipts")
      .$type<Record<string, unknown>[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    status: varchar("status", { length: 32 })
      .$type<NativeLiveMindFollowUpStatus>()
      .default("pending")
      .notNull(),
    retryCount: integer("retry_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lockedBy: uuid("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastErrorName: varchar("last_error_name", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.prepareId, table.userId],
      foreignColumns: [
        nativeLiveTurnPreparations.id,
        nativeLiveTurnPreparations.userId,
      ],
      name: "native_live_mind_followups_preparation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "native_live_mind_followups_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [
        table.assistantMessageId,
        table.conversationId,
        table.userId,
      ],
      foreignColumns: [
        conversationMessages.id,
        conversationMessages.conversationId,
        conversationMessages.userId,
      ],
      name: "native_live_mind_followups_assistant_message_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    index("native_live_mind_followups_status_available_idx").on(
      table.status,
      table.availableAt,
      table.createdAt,
      table.prepareId,
    ),
    index("native_live_mind_followups_user_created_idx").on(
      table.userId,
      table.createdAt,
      table.prepareId,
    ),
    check(
      "native_live_mind_followups_operation_allowed",
      sql`${table.operation} IN ('send', 'retry', 'edit', 'wake')`,
    ),
    check(
      "native_live_mind_followups_intents_array",
      sql`jsonb_typeof(${table.intents}) = 'array'`,
    ),
    check(
      "native_live_mind_followups_actions_array",
      sql`jsonb_typeof(${table.actions}) = 'array'`,
    ),
    check(
      "native_live_mind_followups_receipts_array",
      sql`jsonb_typeof(${table.receipts}) = 'array'`,
    ),
    check(
      "native_live_mind_followups_status_allowed",
      sql`${table.status} IN ('pending', 'processing', 'completed', 'quarantined')`,
    ),
    check(
      "native_live_mind_followups_retry_nonnegative",
      sql`${table.retryCount} >= 0`,
    ),
    check(
      "native_live_mind_followups_lock_consistency",
      sql`(${table.status} = 'pending'
          AND ${table.lockedBy} IS NULL
          AND ${table.lockedUntil} IS NULL
          AND ${table.completedAt} IS NULL)
        OR (${table.status} = 'processing'
          AND ${table.lockedBy} IS NOT NULL
          AND ${table.lockedUntil} IS NOT NULL
          AND ${table.completedAt} IS NULL)
        OR (${table.status} = 'completed'
          AND ${table.lockedBy} IS NULL
          AND ${table.lockedUntil} IS NULL
          AND ${table.completedAt} IS NOT NULL)
        OR (${table.status} = 'quarantined'
          AND ${table.lockedBy} IS NULL
          AND ${table.lockedUntil} IS NULL
          AND ${table.lastErrorName} IS NOT NULL
          AND ${table.completedAt} IS NULL)`,
    ),
  ],
);
