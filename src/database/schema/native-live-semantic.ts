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
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  nativeLiveTurnPreparations,
} from "./native-live-turn.js";
import {
  conversations,
} from "./conversation.js";

export type NativeLiveSemanticScoringStatus =
  | "pending"
  | "reserved"
  | "completed"
  | "fallback";

export const nativeLiveSemanticScoringRequests = pgTable(
  "native_live_semantic_scoring_requests",
  {
    prepareId: uuid("prepare_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    manifestId: uuid("manifest_id").notNull(),
    assembledAt: timestamp("assembled_at", { withTimezone: true }).notNull(),
    snapshotSequence: integer("snapshot_sequence").notNull(),
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
    resumeRetryCount: integer("resume_retry_count").default(0).notNull(),
    resumeAvailableAt: timestamp("resume_available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resumeLastErrorName: varchar("resume_last_error_name", { length: 128 }),
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
      name: "native_live_semantic_scoring_requests_preparation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "native_live_semantic_scoring_requests_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    index("native_live_semantic_scoring_requests_queue_idx").on(
      table.status,
      table.createdAt,
      table.prepareId,
    ),
    index("native_live_semantic_scoring_requests_user_created_idx").on(
      table.userId,
      table.createdAt,
      table.prepareId,
    ),
    index("native_live_semantic_scoring_requests_resume_idx").on(
      table.status,
      table.resumeAvailableAt,
      table.completedAt,
      table.prepareId,
    ),
    check(
      "native_live_semantic_scoring_requests_query_not_blank",
      sql`char_length(btrim(${table.query})) > 0`,
    ),
    check(
      "native_live_semantic_scoring_requests_candidates_array",
      sql`jsonb_typeof(${table.candidates}) = 'array' AND jsonb_array_length(${table.candidates}) BETWEEN 1 AND 64`,
    ),
    check(
      "native_live_semantic_scoring_requests_snapshot_nonnegative",
      sql`${table.snapshotSequence} >= 0`,
    ),
    check(
      "native_live_semantic_scoring_requests_scores_object",
      sql`${table.scores} IS NULL OR jsonb_typeof(${table.scores}) = 'object'`,
    ),
    check(
      "native_live_semantic_scoring_requests_status_allowed",
      sql`${table.status} IN ('pending', 'reserved', 'completed', 'fallback')`,
    ),
    check(
      "native_live_semantic_scoring_requests_resume_retry_nonnegative",
      sql`${table.resumeRetryCount} >= 0`,
    ),
    check(
      "native_live_semantic_scoring_requests_fallback_code_allowed",
      sql`${table.fallbackCode} IS NULL OR ${table.fallbackCode} IN ('E5_PROVIDER_UNAVAILABLE', 'E5_SCORING_FAILED')`,
    ),
    check(
      "native_live_semantic_scoring_requests_state_consistency",
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
