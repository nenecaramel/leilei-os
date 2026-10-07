import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
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
  type NativeLiveSemanticScoringStatus,
} from "./native-live-semantic.js";
import {
  conversationContentBlocks,
  conversations,
  conversationMessages,
} from "./conversation.js";

export type RuntimeDriveSatisfactionEvidenceKind =
  | "user_message"
  | "assistant_message"
  | "tool_result";
export type RuntimeSubjectStateKind =
  | "memory";
/**
 * Kinds that Mind semantic grouping historically covered. The table is no
 * longer written; the type stays wide so archived rows remain representable.
 */
export type RuntimeMindSemanticGroupingKind =
  | "drive"
  | "thought"
  | "curiosity"
  | "topic";
export type RuntimeSubjectScopeApplicability =
  | "global"
  | "conversation"
  | "path";
export type RuntimeSettlementStatus = "unsettled" | "settled" | "rejected";
export type RuntimePathStatus = "current" | "superseded";
export type RuntimeValidityStatus = "valid" | "invalidated" | "tombstoned";

export const runtimeSubjectStates = pgTable(
  "runtime_subject_states",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    subjectId: text("subject_id").notNull(),
    kind: varchar("kind", { length: 32 }).$type<RuntimeSubjectStateKind>().notNull(),
    text: text("text"),
    payload: jsonb("payload").$type<Record<string, unknown> | null>(),
    scopeApplicability: varchar("scope_applicability", { length: 32 })
      .$type<RuntimeSubjectScopeApplicability>()
      .notNull(),
    scopeConversationId: uuid("scope_conversation_id"),
    scopePathHeadMessageId: uuid("scope_path_head_message_id"),
    settlementStatus: varchar("settlement_status", { length: 32 })
      .$type<RuntimeSettlementStatus>()
      .notNull(),
    pathStatus: varchar("path_status", { length: 32 })
      .$type<RuntimePathStatus>()
      .notNull(),
    validityStatus: varchar("validity_status", { length: 32 })
      .$type<RuntimeValidityStatus>()
      .notNull(),
    envelope: jsonb("envelope").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("runtime_subject_states_id_user_unique").on(table.id, table.userId),
    index("runtime_subject_states_user_subject_kind_idx").on(
      table.userId,
      table.subjectId,
      table.kind,
      table.updatedAt.desc(),
    ),
    index("runtime_subject_states_scope_idx").on(
      table.userId,
      table.subjectId,
      table.scopeConversationId,
      table.settlementStatus,
      table.validityStatus,
    ),
    check("runtime_subject_states_subject_not_blank", sql`char_length(btrim(${table.subjectId})) > 0`),
    // Deployment 1 keeps the existing legacy-compatible CHECK for rollout ordering.
    // Deployment 2 TODO: tighten CHECK to memory only after old writers/data are gone.
    check("runtime_subject_states_kind_allowed", sql`${table.kind} IN ('feel', 'memory', 'thought')`),
    check("runtime_subject_states_scope_allowed", sql`${table.scopeApplicability} IN ('global', 'conversation', 'path')`),
    check("runtime_subject_states_settlement_allowed", sql`${table.settlementStatus} IN ('unsettled', 'settled', 'rejected')`),
    check("runtime_subject_states_path_status_allowed", sql`${table.pathStatus} IN ('current', 'superseded')`),
    check("runtime_subject_states_validity_allowed", sql`${table.validityStatus} IN ('valid', 'invalidated', 'tombstoned')`),
    check(
      "runtime_subject_states_scope_consistency",
      sql`(${table.scopeApplicability} = 'global' AND ${table.scopeConversationId} IS NULL AND ${table.scopePathHeadMessageId} IS NULL)
        OR (${table.scopeApplicability} = 'conversation' AND ${table.scopeConversationId} IS NOT NULL AND ${table.scopePathHeadMessageId} IS NULL)
        OR (${table.scopeApplicability} = 'path' AND ${table.scopeConversationId} IS NOT NULL AND ${table.scopePathHeadMessageId} IS NOT NULL)`,
    ),
    check(
      "runtime_subject_states_content_present",
      sql`(${table.text} IS NOT NULL AND char_length(btrim(${table.text})) > 0)
        OR (${table.payload} IS NOT NULL AND jsonb_typeof(${table.payload}) = 'object' AND ${table.payload} <> '{}'::jsonb)`,
    ),
    check("runtime_subject_states_payload_object", sql`${table.payload} IS NULL OR jsonb_typeof(${table.payload}) = 'object'`),
    check("runtime_subject_states_envelope_object", sql`jsonb_typeof(${table.envelope}) = 'object'`),
  ],
);

export const runtimeMindRetirementReceipts = pgTable(
  "runtime_mind_retirement_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    subjectId: text("subject_id").notNull(),
    kind: varchar("kind", { length: 32 })
      .$type<"drive" | "thought" | "curiosity" | "topic">()
      .notNull(),
    anchorStateId: uuid("anchor_state_id").notNull(),
    threadKey: text("thread_key").notNull(),
    stateCount: integer("state_count").notNull(),
    terminalAt: timestamp("terminal_at", { withTimezone: true }).notNull(),
    retentionHours: doublePrecision("retention_hours").notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("runtime_mind_retirement_receipts_user_subject_retired_idx").on(
      table.userId,
      table.subjectId,
      table.retiredAt.desc(),
      table.id.desc(),
    ),
    check(
      "runtime_mind_retirement_receipts_subject_not_blank",
      sql`char_length(btrim(${table.subjectId})) > 0`,
    ),
    check(
      "runtime_mind_retirement_receipts_kind_allowed",
      sql`${table.kind} IN ('drive', 'thought', 'curiosity', 'topic')`,
    ),
    check(
      "runtime_mind_retirement_receipts_thread_not_blank",
      sql`char_length(btrim(${table.threadKey})) > 0`,
    ),
    check(
      "runtime_mind_retirement_receipts_state_count_positive",
      sql`${table.stateCount} > 0`,
    ),
    check(
      "runtime_mind_retirement_receipts_retention_positive",
      sql`${table.retentionHours} > 0`,
    ),
  ],
);

export const runtimeMindSemanticGroupingRequests = pgTable(
  "runtime_mind_semantic_grouping_requests",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    subjectId: text("subject_id").notNull(),
    kind: varchar("kind", { length: 32 })
      .$type<RuntimeMindSemanticGroupingKind>()
      .notNull(),
    queryStateId: uuid("query_state_id").notNull(),
    query: text("query").notNull(),
    candidates: jsonb("candidates")
      .$type<Record<string, unknown>[]>()
      .notNull(),
    status: varchar("status", { length: 32 })
      .$type<NativeLiveSemanticScoringStatus>()
      .default("pending")
      .notNull(),
    reservedBy: uuid("reserved_by"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    reservationExpiresAt: timestamp("reservation_expires_at", {
      withTimezone: true,
    }),
    scores: jsonb("scores").$type<Record<string, number> | null>(),
    fallbackCode: varchar("fallback_code", { length: 64 }),
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
      columns: [table.queryStateId, table.userId],
      foreignColumns: [runtimeSubjectStates.id, runtimeSubjectStates.userId],
      name: "runtime_mind_semantic_grouping_query_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("runtime_mind_semantic_grouping_query_uidx").on(
      table.userId,
      table.subjectId,
      table.kind,
      table.queryStateId,
    ),
    index("runtime_mind_semantic_grouping_queue_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
    index("runtime_mind_semantic_grouping_user_kind_idx").on(
      table.userId,
      table.subjectId,
      table.kind,
      table.completedAt,
    ),
    check(
      "runtime_mind_semantic_grouping_subject_not_blank",
      sql`char_length(btrim(${table.subjectId})) > 0`,
    ),
    check(
      "runtime_mind_semantic_grouping_kind_allowed",
      sql`${table.kind} IN ('drive', 'thought', 'curiosity', 'topic')`,
    ),
    check(
      "runtime_mind_semantic_grouping_query_not_blank",
      sql`char_length(btrim(${table.query})) > 0`,
    ),
    check(
      "runtime_mind_semantic_grouping_candidates_array",
      sql`jsonb_typeof(${table.candidates}) = 'array' AND jsonb_array_length(${table.candidates}) BETWEEN 1 AND 64`,
    ),
    check(
      "runtime_mind_semantic_grouping_scores_object",
      sql`${table.scores} IS NULL OR jsonb_typeof(${table.scores}) = 'object'`,
    ),
    check(
      "runtime_mind_semantic_grouping_status_allowed",
      sql`${table.status} IN ('pending', 'reserved', 'completed', 'fallback')`,
    ),
    check(
      "runtime_mind_semantic_grouping_fallback_code_allowed",
      sql`${table.fallbackCode} IS NULL OR ${table.fallbackCode} IN ('E5_PROVIDER_UNAVAILABLE', 'E5_SCORING_FAILED')`,
    ),
    check(
      "runtime_mind_semantic_grouping_state_consistency",
      sql`(${table.status} = 'pending'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.scores} IS NULL
          AND ${table.fallbackCode} IS NULL
          AND ${table.completedAt} IS NULL)
        OR (${table.status} = 'reserved'
          AND ${table.reservedBy} IS NOT NULL
          AND ${table.reservedAt} IS NOT NULL
          AND ${table.reservationExpiresAt} IS NOT NULL
          AND ${table.scores} IS NULL
          AND ${table.fallbackCode} IS NULL
          AND ${table.completedAt} IS NULL)
        OR (${table.status} = 'completed'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.scores} IS NOT NULL
          AND ${table.fallbackCode} IS NULL
          AND ${table.completedAt} IS NOT NULL)
        OR (${table.status} = 'fallback'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.scores} IS NULL
          AND ${table.fallbackCode} IS NOT NULL
          AND ${table.completedAt} IS NOT NULL)`,
    ),
  ],
);


export const runtimeDriveSatisfactionEvents = pgTable(
  "runtime_drive_satisfaction_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    subjectId: text("subject_id").notNull(),
    driveStateId: uuid("drive_state_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    evidenceMessageId: uuid("evidence_message_id").notNull(),
    evidenceBlockId: uuid("evidence_block_id").references(
      () => conversationContentBlocks.id,
      { onDelete: "cascade", onUpdate: "cascade" },
    ),
    evidenceKind: varchar("evidence_kind", { length: 32 })
      .$type<RuntimeDriveSatisfactionEvidenceKind>()
      .notNull(),
    amount: doublePrecision("amount").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.driveStateId, table.userId],
      foreignColumns: [runtimeSubjectStates.id, runtimeSubjectStates.userId],
      name: "runtime_drive_satisfaction_events_drive_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "runtime_drive_satisfaction_events_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [
        table.evidenceMessageId,
        table.conversationId,
        table.userId,
      ],
      foreignColumns: [
        conversationMessages.id,
        conversationMessages.conversationId,
        conversationMessages.userId,
      ],
      name: "runtime_drive_satisfaction_events_message_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("runtime_drive_satisfaction_events_user_idempotency_uidx").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("runtime_drive_satisfaction_events_drive_created_idx").on(
      table.driveStateId,
      table.createdAt,
      table.id,
    ),
    check(
      "runtime_drive_satisfaction_events_subject_not_blank",
      sql`char_length(btrim(${table.subjectId})) > 0`,
    ),
    check(
      "runtime_drive_satisfaction_events_kind_allowed",
      sql`${table.evidenceKind} IN (\'user_message\', \'assistant_message\', \'tool_result\')`,
    ),
    check(
      "runtime_drive_satisfaction_events_amount_bounds",
      sql`${table.amount} > 0 AND ${table.amount} <= 1`,
    ),
    check(
      "runtime_drive_satisfaction_events_idempotency_format",
      sql`${table.idempotencyKey} ~ \'^[A-Za-z0-9._:-]{16,128}$\'`,
    ),
    check(
      "runtime_drive_satisfaction_events_block_consistency",
      sql`(${table.evidenceKind} IN (\'user_message\', \'assistant_message\') AND ${table.evidenceBlockId} IS NULL)
        OR (${table.evidenceKind} = \'tool_result\' AND ${table.evidenceBlockId} IS NOT NULL)`,
    ),
  ],
);
export const runtimeCuriosityResolutionEvents = pgTable(
  "runtime_curiosity_resolution_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    subjectId: text("subject_id").notNull(),
    curiosityStateId: uuid("curiosity_state_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    requestedResolutionSourceId: uuid("requested_resolution_source_id").notNull(),
    resultResolutionSourceId: text("result_resolution_source_id").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.curiosityStateId, table.userId],
      foreignColumns: [runtimeSubjectStates.id, runtimeSubjectStates.userId],
      name: "runtime_curiosity_resolution_events_state_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "runtime_curiosity_resolution_events_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [
        table.requestedResolutionSourceId,
        table.conversationId,
        table.userId,
      ],
      foreignColumns: [
        conversationMessages.id,
        conversationMessages.conversationId,
        conversationMessages.userId,
      ],
      name: "runtime_curiosity_resolution_events_requested_message_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("runtime_curiosity_resolution_events_user_idempotency_uidx").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("runtime_curiosity_resolution_events_state_created_idx").on(
      table.curiosityStateId,
      table.createdAt,
      table.id,
    ),
    check(
      "runtime_curiosity_resolution_events_subject_not_blank",
      sql`char_length(btrim(${table.subjectId})) > 0`,
    ),
    check(
      "runtime_curiosity_resolution_events_idempotency_format",
      sql`${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]{16,128}$'`,
    ),
  ],
);
export const runtimeSubjectStateTransitions = pgTable(
  "runtime_subject_state_transitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    subjectId: text("subject_id").notNull(),
    stateId: uuid("state_id").notNull(),
    reason: varchar("reason", { length: 64 }).notNull(),
    beforeEnvelope: jsonb("before_envelope").$type<Record<string, unknown>>().notNull(),
    afterEnvelope: jsonb("after_envelope").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.stateId, table.userId],
      foreignColumns: [runtimeSubjectStates.id, runtimeSubjectStates.userId],
      name: "runtime_subject_state_transitions_state_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    index("runtime_subject_state_transitions_state_created_idx").on(
      table.stateId,
      table.createdAt,
      table.id,
    ),
    check("runtime_subject_state_transitions_subject_not_blank", sql`char_length(btrim(${table.subjectId})) > 0`),
    check("runtime_subject_state_transitions_reason_not_blank", sql`char_length(btrim(${table.reason})) > 0`),
    check("runtime_subject_state_transitions_before_object", sql`jsonb_typeof(${table.beforeEnvelope}) = 'object'`),
    check("runtime_subject_state_transitions_after_object", sql`jsonb_typeof(${table.afterEnvelope}) = 'object'`),
  ],
);
