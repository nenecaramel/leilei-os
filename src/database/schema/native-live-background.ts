import { sql } from "drizzle-orm";
import {
  check,
  index,
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

export type NativeLiveBackgroundModelJobStatus =
  | "pending"
  | "reserved"
  | "completed"
  | "failed";

export const nativeLiveBackgroundModelJobs = pgTable(
  "native_live_background_model_jobs",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    subjectId: text("subject_id").notNull(),
    workflowKind: varchar("workflow_kind", { length: 64 }),
    workflowRunId: uuid("workflow_run_id"),
    workflowPayload: jsonb("workflow_payload")
      .$type<Record<string, unknown> | null>(),
    taskKind: varchar("task_kind", { length: 64 }).notNull(),
    promptContractVersion: varchar("prompt_contract_version", {
      length: 128,
    }).notNull(),
    prompt: text("prompt").notNull(),
    status: varchar("status", { length: 32 })
      .$type<NativeLiveBackgroundModelJobStatus>()
      .default("pending")
      .notNull(),
    reservedBy: uuid("reserved_by"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    reservationExpiresAt: timestamp("reservation_expires_at", {
      withTimezone: true,
    }),
    resultText: text("result_text"),
    errorCode: varchar("error_code", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    index("native_live_background_model_jobs_queue_idx").on(
      table.userId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index("native_live_background_model_jobs_terminal_idx").on(
      table.status,
      table.completedAt,
      table.id,
    ),
    index("native_live_background_model_jobs_workflow_idx").on(
      table.userId,
      table.subjectId,
      table.workflowKind,
      table.consumedAt,
      table.createdAt,
      table.id,
    ),
    uniqueIndex("native_live_background_model_jobs_run_stage_uidx").on(
      table.workflowRunId,
      table.taskKind,
    ),
    check(
      "native_live_background_model_jobs_subject_not_blank",
      sql`char_length(btrim(${table.subjectId})) > 0`,
    ),
    check(
      "native_live_background_model_jobs_workflow_consistency",
      sql`(
        ${table.workflowKind} IS NULL
        AND ${table.workflowRunId} IS NULL
        AND ${table.workflowPayload} IS NULL
      ) OR (
        ${table.workflowKind} = 'topic_resurface'
        AND ${table.workflowRunId} IS NOT NULL
        AND ${table.workflowPayload} IS NOT NULL
        AND jsonb_typeof(${table.workflowPayload}) = 'object'
        AND ${table.taskKind} IN (
          'topic_resurface_evaluate',
          'topic_resurface_deliberate',
          'topic_resurface_retention'
        )
      ) OR (
        ${table.workflowKind} = 'distillation'
        AND ${table.workflowRunId} IS NOT NULL
        AND ${table.workflowPayload} IS NOT NULL
        AND jsonb_typeof(${table.workflowPayload}) = 'object'
        AND ${table.taskKind} = 'distillation'
      ) OR (
        ${table.workflowKind} = 'proactivity_wake'
        AND ${table.workflowRunId} IS NOT NULL
        AND ${table.workflowPayload} IS NOT NULL
        AND jsonb_typeof(${table.workflowPayload}) = 'object'
        AND ${table.taskKind} = 'proactivity_deliberate'
      )`,
    ),
    check(
      "native_live_background_model_jobs_task_kind_allowed",
      sql`${table.taskKind} IN ('distillation', 'proactivity_deliberate', 'topic_resurface_evaluate', 'topic_resurface_deliberate', 'topic_resurface_retention')`,
    ),
    check(
      "native_live_background_model_jobs_prompt_contract_not_blank",
      sql`char_length(btrim(${table.promptContractVersion})) > 0`,
    ),
    check(
      "native_live_background_model_jobs_prompt_not_blank",
      sql`char_length(btrim(${table.prompt})) > 0`,
    ),
    check(
      "native_live_background_model_jobs_status_allowed",
      sql`${table.status} IN ('pending', 'reserved', 'completed', 'failed')`,
    ),
    check(
      "native_live_background_model_jobs_consumed_consistency",
      sql`${table.consumedAt} IS NULL
        OR ${table.status} IN ('completed', 'failed')`,
    ),
    check(
      "native_live_background_model_jobs_state_consistency",
      sql`(${table.status} = 'pending'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.resultText} IS NULL
          AND ${table.errorCode} IS NULL
          AND ${table.completedAt} IS NULL)
        OR (${table.status} = 'reserved'
          AND ${table.reservedBy} IS NOT NULL
          AND ${table.reservedAt} IS NOT NULL
          AND ${table.reservationExpiresAt} IS NOT NULL
          AND ${table.resultText} IS NULL
          AND ${table.errorCode} IS NULL
          AND ${table.completedAt} IS NULL)
        OR (${table.status} = 'completed'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.resultText} IS NOT NULL
          AND char_length(btrim(${table.resultText})) > 0
          AND ${table.errorCode} IS NULL
          AND ${table.completedAt} IS NOT NULL)
        OR (${table.status} = 'failed'
          AND ${table.reservedBy} IS NULL
          AND ${table.reservedAt} IS NULL
          AND ${table.reservationExpiresAt} IS NULL
          AND ${table.resultText} IS NULL
          AND ${table.errorCode} IS NOT NULL
          AND char_length(btrim(${table.errorCode})) > 0
          AND ${table.completedAt} IS NOT NULL)`,
    ),
  ],
);
