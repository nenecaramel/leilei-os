import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);

export const diarySourceEnum = pgEnum("diary_source", ["chatgpt_mcp"]);

export const contentAuthorEnum = pgEnum("content_author", ["L", "G", "C"]);

export const todoEntryKindEnum = pgEnum("todo_entry_kind", [
  "pending",
  "completed",
  "record",
]);

export const diaryStatusEnum = pgEnum("diary_status", [
  "active",
  "archived",
]);

export const toolCallStatusEnum = pgEnum("tool_call_status", [
  "success",
  "rejected",
  "error",
]);

export const toyCommandActionEnum = pgEnum("toy_command_action", [
  "set",
  "stop",
]);

export const toyCommandStatusEnum = pgEnum("toy_command_status", [
  "pending",
  "claimed",
  "completed",
  "failed",
  "expired",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    status: userStatusEnum("status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique_idx").on(table.email),
    check(
      "users_email_not_blank",
      sql`char_length(btrim(${table.email})) > 0`,
    ),
    check(
      "users_display_name_not_blank",
      sql`char_length(btrim(${table.displayName})) > 0`,
    ),
  ],
);

export const healthDailySummaries = pgTable(
  "health_daily_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    date: date("date", { mode: "string" }).notNull(),
    steps: integer("steps").notNull(),
    menstruating: boolean("menstruating").notNull(),
    periodStartDate: date("period_start_date", { mode: "string" }),
    cycleDay: integer("cycle_day"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("health_daily_summaries_user_date_uidx").on(
      table.userId,
      table.date,
    ),
    check("health_daily_summaries_steps_nonnegative", sql`${table.steps} >= 0`),
    check(
      "health_daily_summaries_cycle_day_positive",
      sql`${table.cycleDay} IS NULL OR ${table.cycleDay} >= 1`,
    ),
    check(
      "health_daily_summaries_cycle_pair",
      sql`(${table.periodStartDate} IS NULL) = (${table.cycleDay} IS NULL)`,
    ),
    check(
      "health_daily_summaries_period_not_future",
      sql`${table.periodStartDate} IS NULL OR ${table.periodStartDate} <= ${table.date}`,
    ),
    check(
      "health_daily_summaries_cycle_consistent",
      sql`${table.periodStartDate} IS NULL OR ${table.cycleDay} = (${table.date} - ${table.periodStartDate}) + 1`,
    ),
  ],
);

export const todoPapers = pgTable(
  "todo_papers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    businessDate: date("business_date").notNull(),
    author: contentAuthorEnum("author").notNull(),
    revision: integer("revision").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("todo_papers_user_date_author_uidx").on(
      table.userId,
      table.businessDate,
      table.author,
    ),
    check(
      "todo_papers_revision_nonnegative",
      sql`${table.revision} >= 0`,
    ),
  ],
);

export const todoEntries = pgTable(
  "todo_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => todoPapers.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    entryId: text("entry_id").notNull(),
    kind: todoEntryKindEnum("kind").notNull(),
    text: text("text").notNull(),
    revision: integer("revision").default(1).notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    uniqueIndex("todo_entries_paper_entry_uidx").on(
      table.paperId,
      table.entryId,
    ),
    uniqueIndex("todo_entries_paper_position_uidx").on(
      table.paperId,
      table.position,
    ),
    check(
      "todo_entries_entry_id_nonblank",
      sql`char_length(btrim(${table.entryId})) > 0`,
    ),
    check(
      "todo_entries_text_nonblank",
      sql`char_length(btrim(${table.text})) > 0`,
    ),
    check(
      "todo_entries_revision_positive",
      sql`${table.revision} >= 1`,
    ),
    check(
      "todo_entries_position_nonnegative",
      sql`${table.position} >= 0`,
    ),
  ],
);

export const diaryEntries = pgTable(
  "diary_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    title: varchar("title", { length: 200 }).notNull(),
    content: text("content").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    tags: text("tags").array().default(sql`ARRAY[]::text[]`).notNull(),
    mood: varchar("mood", { length: 50 }),
    source: diarySourceEnum("source").default("chatgpt_mcp").notNull(),
    author: contentAuthorEnum("author"),
    status: diaryStatusEnum("status").default("active").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("diary_entries_user_idempotency_unique_idx").on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex("diary_entries_user_id_id_uidx").on(table.userId, table.id),
    index("diary_entries_user_date_created_idx").on(
      table.userId,
      table.date.desc(),
      table.createdAt.desc(),
    ),
    index("diary_entries_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    index("diary_entries_user_status_date_created_idx").on(
      table.userId,
      table.status,
      table.date.desc(),
      table.createdAt.desc(),
    ),
    index("diary_entries_user_status_updated_id_idx").on(
      table.userId,
      table.status,
      table.updatedAt.desc(),
      table.id.desc(),
    ),
    check(
      "diary_entries_title_not_blank",
      sql`char_length(btrim(${table.title})) > 0`,
    ),
    check(
      "diary_entries_content_not_blank",
      sql`char_length(btrim(${table.content})) > 0`,
    ),
    check(
      "diary_entries_mood_not_blank",
      sql`${table.mood} IS NULL OR char_length(btrim(${table.mood})) > 0`,
    ),
    check(
      "diary_entries_idempotency_key_not_blank",
      sql`char_length(btrim(${table.idempotencyKey})) > 0`,
    ),
    check(
      "diary_entries_request_hash_format",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "diary_entries_tags_limit",
      sql`cardinality(${table.tags}) <= 20`,
    ),
  ],
);

export const diaryComments = pgTable(
  "diary_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    diaryId: uuid("diary_id").notNull(),
    author: contentAuthorEnum("author").notNull(),
    content: text("content").notNull(),
    revision: integer("revision").default(1).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.diaryId],
      foreignColumns: [diaryEntries.userId, diaryEntries.id],
      name: "diary_comments_user_diary_fk",
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    uniqueIndex("diary_comments_user_idempotency_unique_idx").on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex("diary_comments_user_id_id_uidx").on(
      table.userId,
      table.id,
    ),
    index("diary_comments_user_diary_created_id_idx").on(
      table.userId,
      table.diaryId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check(
      "diary_comments_content_not_blank",
      sql`char_length(btrim(${table.content})) > 0`,
    ),
    check(
      "diary_comments_content_limit",
      sql`char_length(${table.content}) <= 10000`,
    ),
    check(
      "diary_comments_revision_positive",
      sql`${table.revision} >= 1`,
    ),
    check(
      "diary_comments_idempotency_key_format",
      sql`${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]{16,128}$'`,
    ),
    check(
      "diary_comments_request_hash_format",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    toolName: varchar("tool_name", { length: 100 }).notNull(),
    operation: varchar("operation", { length: 50 }).notNull(),
    resourceType: varchar("resource_type", { length: 50 }).notNull(),
    resourceId: uuid("resource_id").references(() => diaryEntries.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    requestSummary: jsonb("request_summary")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    resultSummary: jsonb("result_summary")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    durationMs: integer("duration_ms").notNull(),
    status: toolCallStatusEnum("status").notNull(),
    errorCode: varchar("error_code", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("tool_calls_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    index("tool_calls_tool_status_created_idx").on(
      table.toolName,
      table.status,
      table.createdAt.desc(),
    ),
    index("tool_calls_resource_idx").on(
      table.resourceType,
      table.resourceId,
    ),
    check(
      "tool_calls_tool_name_not_blank",
      sql`char_length(btrim(${table.toolName})) > 0`,
    ),
    check(
      "tool_calls_operation_not_blank",
      sql`char_length(btrim(${table.operation})) > 0`,
    ),
    check(
      "tool_calls_resource_type_not_blank",
      sql`char_length(btrim(${table.resourceType})) > 0`,
    ),
    check(
      "tool_calls_idempotency_key_not_blank",
      sql`${table.idempotencyKey} IS NULL OR char_length(btrim(${table.idempotencyKey})) > 0`,
    ),
    check("tool_calls_duration_nonnegative", sql`${table.durationMs} >= 0`),
    check(
      "tool_calls_success_has_no_error",
      sql`${table.status} <> 'success' OR ${table.errorCode} IS NULL`,
    ),
  ],
);

export const mcpWriteIdempotency = pgTable(
  "mcp_write_idempotency",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    toolName: varchar("tool_name", { length: 100 })
      .$type<
        | "write_diary"
        | "toy_set"
        | "toy_stop"
        | "write_todo_paper"
        | "append_todo_entry"
        | "update_todo_entry"
        | "delete_todo_entry"
        | "create_universe_node"
        | "create_universe_relation"
        | "add_diary_comment"
      >()
      .notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    resourceType: varchar("resource_type", { length: 32 })
      .$type<
        | "diary_entry"
        | "toy_command"
        | "todo_paper"
        | "todo_entry"
        | "universe_node"
        | "universe_relation"
        | "diary_comment"
      >()
      .notNull(),
    resourceId: text("resource_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("mcp_write_idempotency_user_tool_key_unique_idx").on(
      table.userId,
      table.toolName,
      table.idempotencyKey,
    ),
    index("mcp_write_idempotency_resource_idx").on(
      table.resourceType,
      table.resourceId,
    ),
    index("mcp_write_idempotency_created_id_idx").on(
      table.createdAt.asc(),
      table.id.asc(),
    ),
    check(
      "mcp_write_idempotency_tool_allowed",
      sql`${table.toolName} IN ('write_diary', 'toy_set', 'toy_stop', 'write_todo_paper', 'append_todo_entry', 'update_todo_entry', 'delete_todo_entry', 'create_universe_node', 'create_universe_relation', 'add_diary_comment')`,
    ),
    check(
      "mcp_write_idempotency_key_format",
      sql`${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]{16,128}$'`,
    ),
    check(
      "mcp_write_idempotency_hash_format",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "mcp_write_idempotency_resource_type_allowed",
      sql`${table.resourceType} IN ('diary_entry', 'toy_command', 'todo_paper', 'todo_entry', 'universe_node', 'universe_relation', 'diary_comment')`,
    ),
  ],
);

export const productCreateIdempotency = pgTable(
  "product_create_idempotency",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    operation: varchar("operation", { length: 64 })
      .$type<
        | "workspace_create"
        | "workspace_resource_create"
        | "mind_manual_create"
      >()
      .notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    resourceType: varchar("resource_type", { length: 32 })
      .$type<"workspace" | "workspace_resource" | "mind_state">()
      .notNull(),
    resourceId: text("resource_id").notNull(),
    response: jsonb("response")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("product_create_idempotency_user_operation_key_uidx").on(
      table.userId,
      table.operation,
      table.idempotencyKey,
    ),
    index("product_create_idempotency_resource_idx").on(
      table.resourceType,
      table.resourceId,
    ),
    index("product_create_idempotency_created_id_idx").on(
      table.createdAt.asc(),
      table.id.asc(),
    ),
    check(
      "product_create_idempotency_operation_allowed",
      sql`${table.operation} IN ('workspace_create','workspace_resource_create','mind_manual_create')`,
    ),
    check(
      "product_create_idempotency_key_format",
      sql`${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]{16,128}$'`,
    ),
    check(
      "product_create_idempotency_hash_format",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "product_create_idempotency_resource_type_allowed",
      sql`${table.resourceType} IN ('workspace','workspace_resource','mind_state')`,
    ),
    check(
      "product_create_idempotency_response_object",
      sql`jsonb_typeof(${table.response}) = 'object'`,
    ),
  ],
);

export const resourceLifecycleEvents = pgTable(
  "resource_lifecycle_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    resourceType: varchar("resource_type", { length: 32 })
      .$type<"diary">()
      .notNull(),
    resourceId: uuid("resource_id").notNull(),
    action: varchar("action", { length: 32 })
      .$type<"archive" | "restore" | "permanent_delete">()
      .notNull(),
    actorType: varchar("actor_type", { length: 32 })
      .$type<"user" | "assistant" | "system">()
      .notNull(),
    channel: varchar("channel", { length: 32 })
      .$type<"web" | "mcp" | "internal">()
      .notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("resource_lifecycle_events_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    index("resource_lifecycle_events_resource_created_idx").on(
      table.resourceType,
      table.resourceId,
      table.createdAt.desc(),
    ),
    check(
      "resource_lifecycle_events_resource_type_allowed",
      sql`${table.resourceType} IN ('diary')`,
    ),
    check(
      "resource_lifecycle_events_action_allowed",
      sql`${table.action} IN ('archive', 'restore', 'permanent_delete')`,
    ),
    check(
      "resource_lifecycle_events_actor_type_allowed",
      sql`${table.actorType} IN ('user', 'assistant', 'system')`,
    ),
    check(
      "resource_lifecycle_events_channel_allowed",
      sql`${table.channel} IN ('web', 'mcp', 'internal')`,
    ),
    check(
      "resource_lifecycle_events_metadata_object",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
  ],
);

export const dataImportRuns = pgTable(
  "data_import_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    packageSha256: varchar("package_sha256", { length: 64 }).notNull(),
    previewFingerprint: varchar("preview_fingerprint", { length: 64 }).notNull(),
    schemaVersion: integer("schema_version").notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("data_import_runs_user_created_idx").on(table.userId, table.createdAt.desc()),
    index("data_import_runs_created_id_idx").on(table.createdAt.asc(), table.id.asc()),
    check("data_import_runs_package_sha256_format", sql`${table.packageSha256} ~ '^[0-9a-f]{64}$'`),
    check("data_import_runs_preview_fingerprint_format", sql`${table.previewFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("data_import_runs_summary_object", sql`jsonb_typeof(${table.summary}) = 'object'`),
  ],
);
export type ConversationProvider = "chatgpt" | "claude";
export type ConversationOrigin = "legacy_import" | "native_live";
export type ConversationLifecycleStatus = "active" | "archived" | "deleted";
export type ConversationMessageStatus = "pending" | "streaming" | "completed" | "error";
export type ConversationRuntimeProvider = "claude_code";
export type ProjectResourceKind =
  | "file"
  | "instructions"
  | "settings"
  | "skill"
  | "agent"
  | "mcp"
  | "hook"
  | "plugin";
export type NativeLiveTurnOperation = "send" | "retry" | "edit";
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
export type NativeLiveProviderSessionCleanupStatus =
  | "pending"
  | "reserved"
  | "completed"
  | "failed";
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
export type NativeLiveChatAttachmentKind = "image" | "file";
export type NativeLiveChatAttachmentStatus =
  | "uploading"
  | "ready"
  | "bound"
  | "failed";

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
export type NativeLiveMindFollowUpStatus =
  | "pending"
  | "processing"
  | "completed"
  | "quarantined";
export type NativeLiveSemanticScoringStatus =
  | "pending"
  | "reserved"
  | "completed"
  | "fallback";
export type NativeLiveBackgroundModelJobStatus =
  | "pending"
  | "reserved"
  | "completed"
  | "failed";
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
export type RuntimeDriveSatisfactionEvidenceKind =
  | "user_message"
  | "assistant_message"
  | "tool_result";
export type RuntimeSubjectStateKind =
  | "feel"
  | "memory"
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
export type ConversationExclusionScope = "conversation" | "branch";
export type ConversationFavoriteView = "default" | "all";
export type ConversationImportRunStatus = "processing" | "executed" | "failed";
export type ConversationMessageRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "reasoning"
  | "unknown";
export type ConversationContentKind =
  | "text"
  | "thinking"
  | "reasoning_recap"
  | "tool_use"
  | "tool_result"
  | "image"
  | "audio"
  | "video"
  | "file"
  | "attachment"
  | "unknown";

export const conversationImportSources = pgTable(
  "conversation_import_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    provider: varchar("provider", { length: 32 }).$type<ConversationProvider>().notNull(),
    originalFilename: text("original_filename").notNull(),
    rawSha256: varchar("raw_sha256", { length: 64 }).notNull(),
    rawBytes: bigint("raw_bytes", { mode: "number" }).notNull(),
    storageKind: varchar("storage_kind", { length: 32 }),
    storageKey: text("storage_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("conversation_import_sources_id_user_unique").on(table.id, table.userId),
    uniqueIndex("conversation_import_sources_user_sha_uidx").on(table.userId, table.rawSha256),
    index("conversation_import_sources_user_created_idx").on(table.userId, table.createdAt.desc(), table.id.desc()),
    check("conversation_import_sources_provider_allowed", sql`${table.provider} IN ('chatgpt', 'claude')`),
    check("conversation_import_sources_filename_not_blank", sql`char_length(btrim(${table.originalFilename})) > 0`),
    check("conversation_import_sources_sha_format", sql`${table.rawSha256} ~ '^[0-9a-f]{64}$'`),
    check("conversation_import_sources_raw_bytes_nonnegative", sql`${table.rawBytes} >= 0`),
    check(
      "conversation_import_sources_storage_pair",
      sql`(${table.storageKind} IS NULL AND ${table.storageKey} IS NULL) OR (${table.storageKind} IS NOT NULL AND ${table.storageKey} IS NOT NULL)`,
    ),
  ],
);

export const conversationImportBlobs = pgTable(
  "conversation_import_blobs",
  {
    sourceId: uuid("source_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    encoding: varchar("encoding", { length: 16 }).$type<"raw" | "gzip">().notNull(),
    originalBytes: bigint("original_bytes", { mode: "number" }).notNull(),
    storedBytes: bigint("stored_bytes", { mode: "number" }).notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceId, table.userId],
      foreignColumns: [conversationImportSources.id, conversationImportSources.userId],
      name: "conversation_import_blobs_source_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    check("conversation_import_blobs_encoding_allowed", sql`${table.encoding} IN ('raw', 'gzip')`),
    check("conversation_import_blobs_original_bytes_nonnegative", sql`${table.originalBytes} >= 0`),
    check("conversation_import_blobs_stored_bytes_nonnegative", sql`${table.storedBytes} >= 0`),
  ],
);

export const conversationImportRuns = pgTable(
  "conversation_import_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    parserVersion: varchar("parser_version", { length: 64 }).notNull(),
    executionKey: varchar("execution_key", { length: 64 }).default("standard").notNull(),
    status: varchar("status", { length: 32 }).$type<ConversationImportRunStatus>().default("processing").notNull(),
    previewFingerprint: varchar("preview_fingerprint", { length: 64 }),
    summary: jsonb("summary").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    warningCount: integer("warning_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    unique("conversation_import_runs_id_user_unique").on(table.id, table.userId),
    foreignKey({
      columns: [table.sourceId, table.userId],
      foreignColumns: [conversationImportSources.id, conversationImportSources.userId],
      name: "conversation_import_runs_source_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("conversation_import_runs_execution_executed_uidx")
      .on(table.sourceId, table.parserVersion, table.previewFingerprint, table.executionKey)
      .where(sql`${table.status} = 'executed'`),
    index("conversation_import_runs_user_created_idx").on(table.userId, table.createdAt.desc(), table.id.desc()),
    check("conversation_import_runs_parser_not_blank", sql`char_length(btrim(${table.parserVersion})) > 0`),
    check("conversation_import_runs_execution_key_not_blank", sql`char_length(btrim(${table.executionKey})) > 0`),
    check("conversation_import_runs_status_allowed", sql`${table.status} IN ('processing', 'executed', 'failed')`),
    check(
      "conversation_import_runs_preview_format",
      sql`${table.previewFingerprint} IS NULL OR ${table.previewFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check("conversation_import_runs_summary_object", sql`jsonb_typeof(${table.summary}) = 'object'`),
    check("conversation_import_runs_warning_count_nonnegative", sql`${table.warningCount} >= 0`),
    check(
      "conversation_import_runs_completion_consistency",
      sql`(${table.status} = 'processing' AND ${table.completedAt} IS NULL) OR (${table.status} IN ('executed', 'failed') AND ${table.completedAt} IS NOT NULL)`,
    ),
  ],
);

export const conversationExclusions = pgTable(
  "conversation_exclusions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    provider: varchar("provider", { length: 32 }).$type<ConversationProvider>().notNull(),
    scope: varchar("scope", { length: 32 }).$type<ConversationExclusionScope>().notNull(),
    sourceConversationId: text("source_conversation_id").notNull(),
    sourceNodeId: text("source_node_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("conversation_exclusions_conversation_uidx")
      .on(table.userId, table.provider, table.sourceConversationId)
      .where(sql`${table.scope} = 'conversation'`),
    uniqueIndex("conversation_exclusions_branch_uidx")
      .on(table.userId, table.provider, table.sourceConversationId, table.sourceNodeId)
      .where(sql`${table.scope} = 'branch' AND ${table.sourceNodeId} IS NOT NULL`),
    index("conversation_exclusions_user_provider_idx")
      .on(table.userId, table.provider, table.sourceConversationId),
    check("conversation_exclusions_provider_allowed", sql`${table.provider} IN ('chatgpt', 'claude')`),
    check("conversation_exclusions_scope_allowed", sql`${table.scope} IN ('conversation', 'branch')`),
    check("conversation_exclusions_source_conversation_not_blank", sql`char_length(btrim(${table.sourceConversationId})) > 0`),
    check(
      "conversation_exclusions_scope_node_consistency",
      sql`(${table.scope} = 'conversation' AND ${table.sourceNodeId} IS NULL) OR (${table.scope} = 'branch' AND ${table.sourceNodeId} IS NOT NULL AND char_length(btrim(${table.sourceNodeId})) > 0)`,
    ),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    origin: varchar("origin", { length: 32 }).$type<ConversationOrigin>().default("legacy_import").notNull(),
    provider: varchar("provider", { length: 32 }).$type<ConversationProvider>(),
    sourceConversationId: text("source_conversation_id"),
    title: text("title"),
    lifecycleStatus: varchar("lifecycle_status", { length: 32 })
      .$type<ConversationLifecycleStatus>()
      .default("active")
      .notNull(),
    currentHeadMessageId: uuid("current_head_message_id"),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    currentLeafSourceNodeId: text("current_leaf_source_node_id"),
    defaultModel: text("default_model"),
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    sourceFingerprint: varchar("source_fingerprint", { length: 64 }),
    firstSeenImportId: uuid("first_seen_import_id"),
    lastSeenImportId: uuid("last_seen_import_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("conversations_id_user_unique").on(table.id, table.userId),
    uniqueIndex("conversations_user_provider_source_uidx").on(table.userId, table.provider, table.sourceConversationId),
    index("conversations_user_origin_updated_idx").on(table.userId, table.origin, table.updatedAt.desc(), table.id.desc()),
    index("conversations_user_provider_updated_idx").on(table.userId, table.provider, table.sourceUpdatedAt.desc(), table.id.desc()),
    foreignKey({
      columns: [table.firstSeenImportId, table.userId],
      foreignColumns: [conversationImportRuns.id, conversationImportRuns.userId],
      name: "conversations_first_import_user_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      columns: [table.lastSeenImportId, table.userId],
      foreignColumns: [conversationImportRuns.id, conversationImportRuns.userId],
      name: "conversations_last_import_user_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    check("conversations_origin_allowed", sql`${table.origin} IN ('legacy_import', 'native_live')`),
    check("conversations_lifecycle_status_allowed", sql`${table.lifecycleStatus} IN ('active', 'archived', 'deleted')`),
    check(
      "conversations_origin_provenance_consistency",
      sql`(${table.origin} = 'legacy_import' AND ${table.provider} IS NOT NULL AND ${table.sourceConversationId} IS NOT NULL AND ${table.sourceFingerprint} IS NOT NULL AND ${table.firstSeenImportId} IS NOT NULL AND ${table.lastSeenImportId} IS NOT NULL) OR (${table.origin} = 'native_live' AND ${table.provider} IS NULL AND ${table.sourceConversationId} IS NULL AND ${table.sourceFingerprint} IS NULL AND ${table.firstSeenImportId} IS NULL AND ${table.lastSeenImportId} IS NULL)`,
    ),
    check("conversations_provider_allowed", sql`${table.provider} IS NULL OR ${table.provider} IN ('chatgpt', 'claude')`),
    check("conversations_source_id_not_blank", sql`char_length(btrim(${table.sourceConversationId})) > 0`),
    check("conversations_fingerprint_format", sql`${table.sourceFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("conversations_provider_metadata_object", sql`jsonb_typeof(${table.providerMetadata}) = 'object'`),
    check("conversations_lifecycle_exclusive", sql`NOT (${table.archivedAt} IS NOT NULL AND ${table.deletedAt} IS NOT NULL)`),
  ],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    description: text("description"),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("workspaces_id_user_unique").on(table.id, table.userId),
    index("workspaces_user_updated_idx").on(
      table.userId,
      table.updatedAt.desc(),
      table.id.desc(),
    ),
    check(
      "workspaces_name_not_blank",
      sql`char_length(btrim(${table.name})) > 0`,
    ),
    check(
      "workspaces_name_length",
      sql`char_length(${table.name}) <= 200`,
    ),
    check(
      "workspaces_description_length",
      sql`${table.description} IS NULL OR char_length(${table.description}) <= 4000`,
    ),
    check(
      "workspaces_version_positive",
      sql`${table.version} >= 1`,
    ),
  ],
);

export const workspaceResources = pgTable(
  "workspace_resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    kind: varchar("kind", { length: 32 })
      .$type<ProjectResourceKind>()
      .notNull(),
    resourceKey: text("resource_key").notNull(),
    title: text("title"),
    content: text("content"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaces.id, workspaces.userId],
      name: "workspace_resources_workspace_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("workspace_resources_workspace_kind_key_uidx").on(
      table.workspaceId,
      table.kind,
      table.resourceKey,
    ),
    index("workspace_resources_user_workspace_kind_idx").on(
      table.userId,
      table.workspaceId,
      table.kind,
      table.updatedAt.desc(),
      table.id.desc(),
    ),
    check(
      "workspace_resources_kind_allowed",
      sql`${table.kind} IN ('file','instructions','settings','skill','agent','mcp','hook','plugin')`,
    ),
    check(
      "workspace_resources_key_not_blank",
      sql`char_length(btrim(${table.resourceKey})) > 0`,
    ),
    check(
      "workspace_resources_key_length",
      sql`char_length(${table.resourceKey}) <= 1000`,
    ),
    check(
      "workspace_resources_title_length",
      sql`${table.title} IS NULL OR char_length(${table.title}) <= 500`,
    ),
    check(
      "workspace_resources_content_length",
      sql`${table.content} IS NULL OR char_length(${table.content}) <= 1000000`,
    ),
    check(
      "workspace_resources_metadata_object",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
    check(
      "workspace_resources_version_positive",
      sql`${table.version} >= 1`,
    ),
  ],
);

export const workspaceConversations = pgTable(
  "workspace_conversations",
  {
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.conversationId],
      name: "workspace_conversations_pk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaces.id, workspaces.userId],
      name: "workspace_conversations_workspace_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "workspace_conversations_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    index("workspace_conversations_user_workspace_added_idx").on(
      table.userId,
      table.workspaceId,
      table.addedAt.desc(),
      table.conversationId.desc(),
    ),
  ],
);

export const conversationDeletedBranches = pgTable(
  "conversation_deleted_branches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    provider: varchar("provider", { length: 32 }).$type<ConversationProvider>().notNull(),
    sourceConversationId: text("source_conversation_id").notNull(),
    sourceNodeId: text("source_node_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("conversation_deleted_branches_id_user_unique").on(table.id, table.userId),
    uniqueIndex("conversation_deleted_branches_unit_uidx").on(table.userId, table.conversationId, table.sourceNodeId),
    index("conversation_deleted_branches_user_deleted_idx").on(table.userId, table.deletedAt.desc(), table.id.desc()),
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "conversation_deleted_branches_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    check("conversation_deleted_branches_provider_allowed", sql`${table.provider} IN ('chatgpt', 'claude')`),
    check("conversation_deleted_branches_source_conversation_not_blank", sql`char_length(btrim(${table.sourceConversationId})) > 0`),
    check("conversation_deleted_branches_source_node_not_blank", sql`char_length(btrim(${table.sourceNodeId})) > 0`),
  ],
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    sourceNodeId: text("source_node_id"),
    sourceMessageId: text("source_message_id"),
    parentSourceNodeId: text("parent_source_node_id"),
    parentMessageId: uuid("parent_message_id"),
    role: varchar("role", { length: 32 }).$type<ConversationMessageRole>().notNull(),
    status: varchar("status", { length: 32 }).$type<ConversationMessageStatus>().default("completed").notNull(),
    rawRole: text("raw_role"),
    model: text("model"),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    isCurrentPath: boolean("is_current_path").default(false).notNull(),
    currentPathIndex: integer("current_path_index"),
    turnIndex: integer("turn_index"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    displayText: text("display_text").default("").notNull(),
    sourceFingerprint: varchar("source_fingerprint", { length: 64 }),
    firstSeenImportId: uuid("first_seen_import_id"),
    lastSeenImportId: uuid("last_seen_import_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("conversation_messages_id_user_unique").on(table.id, table.userId),
    unique("conversation_messages_id_conversation_user_unique").on(table.id, table.conversationId, table.userId),
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "conversation_messages_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.parentMessageId, table.conversationId, table.userId],
      foreignColumns: [table.id, table.conversationId, table.userId],
      name: "conversation_messages_parent_same_conversation_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.firstSeenImportId, table.userId],
      foreignColumns: [conversationImportRuns.id, conversationImportRuns.userId],
      name: "conversation_messages_first_import_user_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      columns: [table.lastSeenImportId, table.userId],
      foreignColumns: [conversationImportRuns.id, conversationImportRuns.userId],
      name: "conversation_messages_last_import_user_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    uniqueIndex("conversation_messages_conversation_node_uidx").on(table.conversationId, table.sourceNodeId),
    uniqueIndex("conversation_messages_conversation_source_message_uidx")
      .on(table.conversationId, table.sourceMessageId)
      .where(sql`${table.sourceMessageId} IS NOT NULL`),
    uniqueIndex("conversation_messages_current_path_index_uidx")
      .on(table.conversationId, table.currentPathIndex)
      .where(sql`${table.isCurrentPath} = true AND ${table.currentPathIndex} IS NOT NULL`),
    index("conversation_messages_user_source_created_idx").on(table.userId, table.sourceCreatedAt, table.id),
    index("conversation_messages_conversation_parent_idx").on(table.conversationId, table.parentMessageId, table.createdAt, table.id),
    index("conversation_messages_conversation_path_idx").on(table.conversationId, table.isCurrentPath, table.currentPathIndex),
    check("conversation_messages_source_node_not_blank", sql`char_length(btrim(${table.sourceNodeId})) > 0`),
    check("conversation_messages_status_allowed", sql`${table.status} IN ('pending', 'streaming', 'completed', 'error')`),
    check(
      "conversation_messages_provenance_consistency",
      sql`(${table.sourceNodeId} IS NULL AND ${table.parentSourceNodeId} IS NULL AND ${table.sourceFingerprint} IS NULL AND ${table.firstSeenImportId} IS NULL AND ${table.lastSeenImportId} IS NULL) OR (${table.sourceNodeId} IS NOT NULL AND ${table.sourceFingerprint} IS NOT NULL AND ${table.firstSeenImportId} IS NOT NULL AND ${table.lastSeenImportId} IS NOT NULL)`,
    ),
    check(
      "conversation_messages_role_allowed",
      sql`${table.role} IN ('user', 'assistant', 'system', 'tool', 'reasoning', 'unknown')`,
    ),
    check("conversation_messages_fingerprint_format", sql`${table.sourceFingerprint} ~ '^[0-9a-f]{64}$'`),
    check(
      "conversation_messages_path_consistency",
      sql`(${table.isCurrentPath} = true AND ${table.currentPathIndex} IS NOT NULL AND ${table.currentPathIndex} >= 0) OR (${table.isCurrentPath} = false AND ${table.currentPathIndex} IS NULL)`,
    ),
    check("conversation_messages_turn_nonnegative", sql`${table.turnIndex} IS NULL OR ${table.turnIndex} >= 0`),
  ],
);

export const conversationContentBlocks = pgTable(
  "conversation_content_blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    messageId: uuid("message_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    kind: varchar("kind", { length: 32 }).$type<ConversationContentKind>().notNull(),
    rawType: text("raw_type").notNull(),
    text: text("text"),
    payload: jsonb("payload").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.messageId, table.userId],
      foreignColumns: [conversationMessages.id, conversationMessages.userId],
      name: "conversation_content_blocks_message_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("conversation_content_blocks_message_ordinal_uidx").on(table.messageId, table.ordinal),
    index("conversation_content_blocks_user_kind_idx").on(table.userId, table.kind),
    check("conversation_content_blocks_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check(
      "conversation_content_blocks_kind_allowed",
      sql`${table.kind} IN ('text', 'thinking', 'reasoning_recap', 'tool_use', 'tool_result', 'image', 'audio', 'video', 'file', 'attachment', 'unknown')`,
    ),
    check("conversation_content_blocks_raw_type_not_blank", sql`char_length(btrim(${table.rawType})) > 0`),
    check(
      "conversation_content_blocks_payload_object",
      sql`${table.payload} IS NULL OR jsonb_typeof(${table.payload}) = 'object'`,
    ),
  ],
);


export const conversationProviderSessionCheckpoints = pgTable(
  "conversation_provider_session_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    canonicalMessageId: uuid("canonical_message_id").notNull(),
    provider: varchar("provider", { length: 32 })
      .$type<ConversationRuntimeProvider>()
      .notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    workspaceId: uuid("workspace_id"),
    effectiveWorkspaceRoot: text("effective_workspace_root"),
    runtimeMetadata: jsonb("runtime_metadata")
      .$type<Record<string, unknown> | null>(),
    providerCheckpointId: text("provider_checkpoint_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "conversation_provider_session_checkpoints_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.canonicalMessageId, table.conversationId, table.userId],
      foreignColumns: [
        conversationMessages.id,
        conversationMessages.conversationId,
        conversationMessages.userId,
      ],
      name: "conversation_provider_session_checkpoints_message_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("conversation_provider_session_checkpoints_message_provider_uidx").on(
      table.conversationId,
      table.canonicalMessageId,
      table.provider,
    ),
    index("conversation_provider_session_checkpoints_user_head_idx").on(
      table.userId,
      table.conversationId,
      table.canonicalMessageId,
    ),
    index("conversation_provider_session_checkpoints_workspace_idx").on(
      table.userId,
      table.workspaceId,
      table.createdAt,
    ),
    check(
      "conversation_provider_session_checkpoints_provider_allowed",
      sql`${table.provider} = 'claude_code'`,
    ),
    check(
      "conversation_provider_session_checkpoints_session_not_blank",
      sql`char_length(btrim(${table.providerSessionId})) > 0`,
    ),
    check(
      "conversation_provider_session_checkpoints_checkpoint_not_blank",
      sql`${table.providerCheckpointId} IS NULL OR char_length(btrim(${table.providerCheckpointId})) > 0`,
    ),
    check(
      "conversation_provider_session_checkpoints_workspace_root_not_blank",
      sql`${table.effectiveWorkspaceRoot} IS NULL OR char_length(btrim(${table.effectiveWorkspaceRoot})) > 0`,
    ),
  ],
);

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
    canonicalUserMessageId: uuid("canonical_user_message_id").notNull(),
    replacementTargetUserMessageId: uuid("replacement_target_user_message_id"),
    runtimeMode: varchar("runtime_mode", { length: 16 })
      .$type<NativeLiveTurnRuntimeMode>()
      .notNull(),
    parentProviderSessionId: text("parent_provider_session_id"),
    workspaceId: uuid("workspace_id"),
    expectedWorkspaceRoot: text("expected_workspace_root"),
    executionSelection: jsonb("execution_selection").$type<Record<string, unknown> | null>(),
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
      sql`${table.operation} IN ('send', 'retry', 'edit')`,
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
      "native_live_turn_preparations_workspace_root_not_blank",
      sql`${table.expectedWorkspaceRoot} IS NULL OR char_length(btrim(${table.expectedWorkspaceRoot})) > 0`,
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
      sql`${table.operation} IN ('send', 'retry', 'edit')`,
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
    check("runtime_subject_states_kind_allowed", sql`${table.kind} IN ('feel', 'memory', 'drive', 'thought', 'curiosity', 'topic')`),
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
      .$type<RuntimeSubjectStateKind>()
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

export const runtimeContextManifests = pgTable(
  "runtime_context_manifests",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    subjectId: text("subject_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    pathHeadMessageId: uuid("path_head_message_id"),
    snapshotSequence: integer("snapshot_sequence").notNull(),
    assemblyVersion: varchar("assembly_version", { length: 64 }).notNull(),
    promptContractVersion: varchar("prompt_contract_version", { length: 64 }).notNull(),
    budget: jsonb("budget").$type<Record<string, unknown>>().notNull(),
    items: jsonb("items").$type<Record<string, unknown>[]>().notNull(),
    assembledAt: timestamp("assembled_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "runtime_context_manifests_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.pathHeadMessageId, table.conversationId, table.userId],
      foreignColumns: [
        conversationMessages.id,
        conversationMessages.conversationId,
        conversationMessages.userId,
      ],
      name: "runtime_context_manifests_head_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    index("runtime_context_manifests_user_subject_created_idx").on(
      table.userId,
      table.subjectId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check("runtime_context_manifests_subject_not_blank", sql`char_length(btrim(${table.subjectId})) > 0`),
    check("runtime_context_manifests_snapshot_nonnegative", sql`${table.snapshotSequence} >= 0`),
    check("runtime_context_manifests_assembly_not_blank", sql`char_length(btrim(${table.assemblyVersion})) > 0`),
    check("runtime_context_manifests_prompt_not_blank", sql`char_length(btrim(${table.promptContractVersion})) > 0`),
    check("runtime_context_manifests_budget_object", sql`jsonb_typeof(${table.budget}) = 'object'`),
    check("runtime_context_manifests_items_array", sql`jsonb_typeof(${table.items}) = 'array'`),
  ],
);

export const runtimeDistillationWatermarks = pgTable(
  "runtime_distillation_watermarks",
  {
    userId: uuid("user_id").notNull(),
    subjectId: text("subject_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    lastSourceMessageId: uuid("last_source_message_id").notNull(),
    processVersion: varchar("process_version", { length: 64 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.subjectId, table.conversationId],
      name: "runtime_distillation_watermarks_pk",
    }),
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "runtime_distillation_watermarks_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.lastSourceMessageId, table.conversationId, table.userId],
      foreignColumns: [
        conversationMessages.id,
        conversationMessages.conversationId,
        conversationMessages.userId,
      ],
      name: "runtime_distillation_watermarks_message_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    check(
      "runtime_distillation_watermarks_subject_not_blank",
      sql`char_length(btrim(${table.subjectId})) > 0`,
    ),
    check(
      "runtime_distillation_watermarks_process_not_blank",
      sql`char_length(btrim(${table.processVersion})) > 0`,
    ),
  ],
);

export const nativeLiveChatAttachments = pgTable(
  "native_live_chat_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 16 })
      .$type<NativeLiveChatAttachmentKind>()
      .notNull(),
    status: varchar("status", { length: 16 })
      .$type<NativeLiveChatAttachmentStatus>()
      .default("uploading")
      .notNull(),
    boundMessageId: uuid("bound_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    boundAt: timestamp("bound_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("native_live_chat_attachments_user_object_uidx").on(
      table.userId,
      table.objectKey,
    ),
    index("native_live_chat_attachments_user_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index("native_live_chat_attachments_bound_message_idx").on(
      table.userId,
      table.boundMessageId,
    ),
    check(
      "native_live_chat_attachments_object_key_not_blank",
      sql`char_length(btrim(${table.objectKey})) > 0`,
    ),
    check(
      "native_live_chat_attachments_filename_not_blank",
      sql`char_length(btrim(${table.filename})) > 0`,
    ),
    check(
      "native_live_chat_attachments_mime_not_blank",
      sql`char_length(btrim(${table.mimeType})) > 0`,
    ),
    check(
      "native_live_chat_attachments_size_positive",
      sql`${table.sizeBytes} > 0`,
    ),
    check(
      "native_live_chat_attachments_sha_format",
      sql`${table.sha256} ~ '^[0-9a-f]{64}
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    messageId: uuid("message_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    sourceAttachmentId: text("source_attachment_id"),
    name: text("name"),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.messageId, table.userId],
      foreignColumns: [conversationMessages.id, conversationMessages.userId],
      name: "conversation_attachments_message_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("conversation_attachments_message_ordinal_uidx").on(table.messageId, table.ordinal),
    index("conversation_attachments_user_source_idx").on(table.userId, table.sourceAttachmentId),
    check("conversation_attachments_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check("conversation_attachments_size_nonnegative", sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`),
    check("conversation_attachments_payload_object", sql`jsonb_typeof(${table.payload}) = 'object'`),
  ],
);

export const conversationFavorites = pgTable(
  "conversation_favorites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    provider: varchar("provider", { length: 32 }).$type<ConversationProvider>().notNull(),
    sourceConversationId: text("source_conversation_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    view: varchar("view", { length: 16 }).$type<ConversationFavoriteView>().default("default").notNull(),
    title: text("title"),
    note: text("note"),
    tags: jsonb("tags").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    conversationTitleSnapshot: text("conversation_title_snapshot"),
    startMessageId: uuid("start_message_id").notNull(),
    endMessageId: uuid("end_message_id").notNull(),
    startSourceNodeId: text("start_source_node_id").notNull(),
    endSourceNodeId: text("end_source_node_id").notNull(),
    messageCount: integer("message_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("conversation_favorites_id_user_unique").on(table.id, table.userId),
    index("conversation_favorites_user_created_idx").on(table.userId, table.createdAt.desc(), table.id.desc()),
    index("conversation_favorites_user_provider_created_idx").on(table.userId, table.provider, table.createdAt.desc(), table.id.desc()),
    index("conversation_favorites_user_conversation_idx").on(table.userId, table.conversationId, table.createdAt.desc()),
    check("conversation_favorites_provider_allowed", sql`${table.provider} IN ('chatgpt', 'claude')`),
    check("conversation_favorites_view_allowed", sql`${table.view} IN ('default', 'all')`),
    check("conversation_favorites_source_conversation_not_blank", sql`char_length(btrim(${table.sourceConversationId})) > 0`),
    check("conversation_favorites_start_node_not_blank", sql`char_length(btrim(${table.startSourceNodeId})) > 0`),
    check("conversation_favorites_end_node_not_blank", sql`char_length(btrim(${table.endSourceNodeId})) > 0`),
    check("conversation_favorites_message_count_bounds", sql`${table.messageCount} BETWEEN 1 AND 200`),
    check("conversation_favorites_title_bounds", sql`${table.title} IS NULL OR char_length(${table.title}) <= 200`),
    check("conversation_favorites_note_bounds", sql`${table.note} IS NULL OR char_length(${table.note}) <= 4000`),
    check("conversation_favorites_tags_array", sql`jsonb_typeof(${table.tags}) = 'array'`),
  ],
);

export const conversationFavoriteMessages = pgTable(
  "conversation_favorite_messages",
  {
    favoriteId: uuid("favorite_id").notNull(),
    userId: uuid("user_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    messageId: uuid("message_id").notNull(),
    sourceNodeId: text("source_node_id").notNull(),
    sourceMessageId: text("source_message_id"),
    role: varchar("role", { length: 32 }).$type<ConversationMessageRole>().notNull(),
    model: text("model"),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    displayText: text("display_text").default("").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.favoriteId, table.ordinal], name: "conversation_favorite_messages_pk" }),
    foreignKey({
      columns: [table.favoriteId, table.userId],
      foreignColumns: [conversationFavorites.id, conversationFavorites.userId],
      name: "conversation_favorite_messages_favorite_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("conversation_favorite_messages_favorite_message_uidx").on(table.favoriteId, table.messageId),
    index("conversation_favorite_messages_user_message_idx").on(table.userId, table.messageId),
    check("conversation_favorite_messages_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check("conversation_favorite_messages_source_node_not_blank", sql`char_length(btrim(${table.sourceNodeId})) > 0`),
    check(
      "conversation_favorite_messages_role_allowed",
      sql`${table.role} IN ('user', 'assistant', 'system', 'tool', 'reasoning', 'unknown')`,
    ),
    check("conversation_favorite_messages_snapshot_object", sql`jsonb_typeof(${table.snapshot}) = 'object'`),
  ],
);

export const conversationMessageVersions = pgTable(
  "conversation_message_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    messageId: uuid("message_id").notNull(),
    previousFingerprint: varchar("previous_fingerprint", { length: 64 }).notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    replacedByImportId: uuid("replaced_by_import_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.messageId, table.userId],
      foreignColumns: [conversationMessages.id, conversationMessages.userId],
      name: "conversation_message_versions_message_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.replacedByImportId, table.userId],
      foreignColumns: [conversationImportRuns.id, conversationImportRuns.userId],
      name: "conversation_message_versions_import_user_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    index("conversation_message_versions_message_created_idx").on(table.messageId, table.createdAt.desc(), table.id.desc()),
    check("conversation_message_versions_fingerprint_format", sql`${table.previousFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("conversation_message_versions_snapshot_object", sql`jsonb_typeof(${table.snapshot}) = 'object'`),
  ],
);


export const universeMeta = pgTable(
  "universe_meta",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    name: text("name").notNull(),
    schemaVersion: integer("schema_version").default(2).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    version: integer("version").default(0).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId] }),
    check("universe_meta_schema_version", sql`${table.schemaVersion} = 2`),
    check("universe_meta_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const universeGalaxies = pgTable(
  "universe_galaxies",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    color: text("color").notNull(),
    order: doublePrecision("order").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.id] })],
);

export const universeNodes = pgTable(
  "universe_nodes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    content: text("content").notNull(),
    type: text("type").notNull(),
    tags: text("tags").array().default(sql`ARRAY[]::text[]`).notNull(),
    galaxies: text("galaxies").array().default(sql`ARRAY[]::text[]`).notNull(),
    galaxyMemberships: jsonb("galaxy_memberships")
      .$type<Array<{ id: string; weight: number }>>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    position: jsonb("position").$type<{ x: number; y: number }>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    importance: text("importance"),
    migration: jsonb("migration").$type<{ source: string; migratedAt: string }>(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("universe_nodes_user_updated_idx").on(table.userId, table.updatedAt.desc()),
    check("universe_nodes_position_object", sql`jsonb_typeof(${table.position}) = 'object'`),
    check(
      "universe_nodes_galaxy_memberships_array",
      sql`jsonb_typeof(${table.galaxyMemberships}) = 'array'`,
    ),
    check(
      "universe_nodes_legacy_galaxies_empty",
      sql`cardinality(${table.galaxies}) = 0`,
    ),
  ],
);

export const universeDiarySources = pgTable(
  "universe_diary_sources",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    nodeId: text("node_id").notNull(),
    diaryId: uuid("diary_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.nodeId, table.diaryId] }),
    foreignKey({
      columns: [table.userId, table.nodeId],
      foreignColumns: [universeNodes.userId, universeNodes.id],
      name: "universe_diary_sources_node_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.userId, table.diaryId],
      foreignColumns: [diaryEntries.userId, diaryEntries.id],
      name: "universe_diary_sources_diary_fk",
    }).onDelete("cascade").onUpdate("cascade"),
  ],
);

export const universeRelations = pgTable(
  "universe_relations",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    source: text("source").notNull(),
    target: text("target").notNull(),
    relationType: text("relation_type").notNull(),
    strength: doublePrecision("strength").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("universe_relations_user_source_target_type_uidx").on(
      table.userId,
      table.source,
      table.target,
      table.relationType,
    ),
    index("universe_relations_user_nodes_idx").on(table.userId, table.source, table.target),
    check(
      "universe_relations_type_allowed",
      sql`${table.relationType} IN ('related_to', 'supports', 'contradicts', 'extends', 'part_of', 'raises')`,
    ),
  ],
);

export const universeRevisions = pgTable(
  "universe_revisions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    nodeId: text("node_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("universe_revisions_user_node_created_idx").on(
      table.userId,
      table.nodeId,
      table.createdAt.desc(),
    ),
    check("universe_revisions_snapshot_object", sql`jsonb_typeof(${table.snapshot}) = 'object'`),
  ],
);

export const universeBackups = pgTable(
  "universe_backups",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("universe_backups_user_created_idx").on(table.userId, table.createdAt.desc()),
    check("universe_backups_data_object", sql`jsonb_typeof(${table.data}) = 'object'`),
    check("universe_backups_no_recursive_backups", sql`NOT (${table.data} ? 'backups')`),
  ],
);

export const toyCommands = pgTable(
  "toy_commands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    action: toyCommandActionEnum("action").notNull(),
    percent: integer("percent"),
    durationSeconds: integer("duration_seconds").default(60),
    status: toyCommandStatusEnum("status").default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    error: varchar("error", { length: 500 }),
  },
  (table) => [
    index("toy_commands_claim_queue_idx").on(
      table.userId,
      table.status,
      table.expiresAt,
      table.action,
      table.createdAt,
      table.id,
    ),
    check(
      "toy_commands_action_allowed",
      sql`${table.action} IN ('set', 'stop')`,
    ),
    check(
      "toy_commands_status_allowed",
      sql`${table.status} IN ('pending', 'claimed', 'completed', 'failed', 'expired')`,
    ),
    check(
      "toy_commands_action_percent_consistency",
      sql`(${table.action} = 'set' AND ${table.percent} IS NOT NULL AND ${table.percent} BETWEEN 1 AND 50) OR (${table.action} = 'stop' AND ${table.percent} IS NULL)`,
    ),
    check(
      "toy_commands_error_length",
      sql`${table.error} IS NULL OR char_length(${table.error}) <= 500`,
    ),
    check(
      "toy_commands_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "toy_commands_duration_seconds_consistency",
      sql`(${table.action} = 'set' AND ${table.durationSeconds} BETWEEN 1 AND 1200) OR (${table.action} = 'stop' AND (${table.durationSeconds} IS NULL OR ${table.durationSeconds} = 60))`,
    ),
  ],
);
export type UserPageCopy = {
  diarySubtitle?: string;
  settingsSubtitle?: string;
  homeHeroEyebrow?: string | null;
  homeHeroTitleMode?: "auto" | "custom";
  homeHeroTitle?: string | null;
  homeHeroDescriptionMode?: "auto" | "custom";
  homeHeroDescription?: string | null;
};

export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    accentColor: varchar("accent_color", { length: 7 })
      .default("#405f4d")
      .notNull(),

    homeTitle: varchar("home_title", { length: 120 }),

    homeSubtitle: varchar("home_subtitle", { length: 240 }),

    preferredName: varchar("preferred_name", { length: 80 }),

    timezone: varchar("timezone", { length: 64 })
      .default("Asia/Shanghai")
      .notNull(),

    pageCopy: jsonb("page_copy")
      .$type<UserPageCopy>()
      .default(sql`'{}'::jsonb`)
      .notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_settings_user_unique_idx").on(table.userId),

    check(
      "user_settings_accent_color_format",
      sql`${table.accentColor} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),

    check(
      "user_settings_home_title_not_blank",
      sql`${table.homeTitle} IS NULL OR char_length(btrim(${table.homeTitle})) > 0`,
    ),

    check(
      "user_settings_home_subtitle_not_blank",
      sql`${table.homeSubtitle} IS NULL OR char_length(btrim(${table.homeSubtitle})) > 0`,
    ),

    check(
      "user_settings_preferred_name_not_blank",
      sql`${table.preferredName} IS NULL OR char_length(btrim(${table.preferredName})) > 0`,
    ),

    check(
      "user_settings_timezone_not_blank",
      sql`char_length(btrim(${table.timezone})) > 0`,
    ),
  ],
);
`,
    ),
    check(
      "native_live_chat_attachments_kind_allowed",
      sql`${table.kind} IN ('image', 'file')`,
    ),
    check(
      "native_live_chat_attachments_status_allowed",
      sql`${table.status} IN ('uploading', 'ready', 'bound', 'failed')`,
    ),
    check(
      "native_live_chat_attachments_state_consistency",
      sql`(
        ${table.status} = 'uploading'
        AND ${table.readyAt} IS NULL
        AND ${table.boundAt} IS NULL
        AND ${table.failedAt} IS NULL
        AND ${table.boundMessageId} IS NULL
      ) OR (
        ${table.status} = 'ready'
        AND ${table.readyAt} IS NOT NULL
        AND ${table.boundAt} IS NULL
        AND ${table.failedAt} IS NULL
        AND ${table.boundMessageId} IS NULL
      ) OR (
        ${table.status} = 'bound'
        AND ${table.readyAt} IS NOT NULL
        AND ${table.boundAt} IS NOT NULL
        AND ${table.failedAt} IS NULL
        AND ${table.boundMessageId} IS NOT NULL
      ) OR (
        ${table.status} = 'failed'
        AND ${table.boundAt} IS NULL
        AND ${table.failedAt} IS NOT NULL
        AND ${table.boundMessageId} IS NULL
      )`,
    ),
  ],
);

export const conversationAttachments = pgTable(
  "conversation_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    messageId: uuid("message_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    sourceAttachmentId: text("source_attachment_id"),
    name: text("name"),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.messageId, table.userId],
      foreignColumns: [conversationMessages.id, conversationMessages.userId],
      name: "conversation_attachments_message_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("conversation_attachments_message_ordinal_uidx").on(table.messageId, table.ordinal),
    index("conversation_attachments_user_source_idx").on(table.userId, table.sourceAttachmentId),
    check("conversation_attachments_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check("conversation_attachments_size_nonnegative", sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`),
    check("conversation_attachments_payload_object", sql`jsonb_typeof(${table.payload}) = 'object'`),
  ],
);

export const conversationFavorites = pgTable(
  "conversation_favorites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    provider: varchar("provider", { length: 32 }).$type<ConversationProvider>().notNull(),
    sourceConversationId: text("source_conversation_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    view: varchar("view", { length: 16 }).$type<ConversationFavoriteView>().default("default").notNull(),
    title: text("title"),
    note: text("note"),
    tags: jsonb("tags").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    conversationTitleSnapshot: text("conversation_title_snapshot"),
    startMessageId: uuid("start_message_id").notNull(),
    endMessageId: uuid("end_message_id").notNull(),
    startSourceNodeId: text("start_source_node_id").notNull(),
    endSourceNodeId: text("end_source_node_id").notNull(),
    messageCount: integer("message_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("conversation_favorites_id_user_unique").on(table.id, table.userId),
    index("conversation_favorites_user_created_idx").on(table.userId, table.createdAt.desc(), table.id.desc()),
    index("conversation_favorites_user_provider_created_idx").on(table.userId, table.provider, table.createdAt.desc(), table.id.desc()),
    index("conversation_favorites_user_conversation_idx").on(table.userId, table.conversationId, table.createdAt.desc()),
    check("conversation_favorites_provider_allowed", sql`${table.provider} IN ('chatgpt', 'claude')`),
    check("conversation_favorites_view_allowed", sql`${table.view} IN ('default', 'all')`),
    check("conversation_favorites_source_conversation_not_blank", sql`char_length(btrim(${table.sourceConversationId})) > 0`),
    check("conversation_favorites_start_node_not_blank", sql`char_length(btrim(${table.startSourceNodeId})) > 0`),
    check("conversation_favorites_end_node_not_blank", sql`char_length(btrim(${table.endSourceNodeId})) > 0`),
    check("conversation_favorites_message_count_bounds", sql`${table.messageCount} BETWEEN 1 AND 200`),
    check("conversation_favorites_title_bounds", sql`${table.title} IS NULL OR char_length(${table.title}) <= 200`),
    check("conversation_favorites_note_bounds", sql`${table.note} IS NULL OR char_length(${table.note}) <= 4000`),
    check("conversation_favorites_tags_array", sql`jsonb_typeof(${table.tags}) = 'array'`),
  ],
);

export const conversationFavoriteMessages = pgTable(
  "conversation_favorite_messages",
  {
    favoriteId: uuid("favorite_id").notNull(),
    userId: uuid("user_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    messageId: uuid("message_id").notNull(),
    sourceNodeId: text("source_node_id").notNull(),
    sourceMessageId: text("source_message_id"),
    role: varchar("role", { length: 32 }).$type<ConversationMessageRole>().notNull(),
    model: text("model"),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    displayText: text("display_text").default("").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.favoriteId, table.ordinal], name: "conversation_favorite_messages_pk" }),
    foreignKey({
      columns: [table.favoriteId, table.userId],
      foreignColumns: [conversationFavorites.id, conversationFavorites.userId],
      name: "conversation_favorite_messages_favorite_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("conversation_favorite_messages_favorite_message_uidx").on(table.favoriteId, table.messageId),
    index("conversation_favorite_messages_user_message_idx").on(table.userId, table.messageId),
    check("conversation_favorite_messages_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check("conversation_favorite_messages_source_node_not_blank", sql`char_length(btrim(${table.sourceNodeId})) > 0`),
    check(
      "conversation_favorite_messages_role_allowed",
      sql`${table.role} IN ('user', 'assistant', 'system', 'tool', 'reasoning', 'unknown')`,
    ),
    check("conversation_favorite_messages_snapshot_object", sql`jsonb_typeof(${table.snapshot}) = 'object'`),
  ],
);

export const conversationMessageVersions = pgTable(
  "conversation_message_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    messageId: uuid("message_id").notNull(),
    previousFingerprint: varchar("previous_fingerprint", { length: 64 }).notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    replacedByImportId: uuid("replaced_by_import_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.messageId, table.userId],
      foreignColumns: [conversationMessages.id, conversationMessages.userId],
      name: "conversation_message_versions_message_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.replacedByImportId, table.userId],
      foreignColumns: [conversationImportRuns.id, conversationImportRuns.userId],
      name: "conversation_message_versions_import_user_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    index("conversation_message_versions_message_created_idx").on(table.messageId, table.createdAt.desc(), table.id.desc()),
    check("conversation_message_versions_fingerprint_format", sql`${table.previousFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("conversation_message_versions_snapshot_object", sql`jsonb_typeof(${table.snapshot}) = 'object'`),
  ],
);


export const universeMeta = pgTable(
  "universe_meta",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    name: text("name").notNull(),
    schemaVersion: integer("schema_version").default(2).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    version: integer("version").default(0).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId] }),
    check("universe_meta_schema_version", sql`${table.schemaVersion} = 2`),
    check("universe_meta_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const universeGalaxies = pgTable(
  "universe_galaxies",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    color: text("color").notNull(),
    order: doublePrecision("order").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.id] })],
);

export const universeNodes = pgTable(
  "universe_nodes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    content: text("content").notNull(),
    type: text("type").notNull(),
    tags: text("tags").array().default(sql`ARRAY[]::text[]`).notNull(),
    galaxies: text("galaxies").array().default(sql`ARRAY[]::text[]`).notNull(),
    galaxyMemberships: jsonb("galaxy_memberships")
      .$type<Array<{ id: string; weight: number }>>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    position: jsonb("position").$type<{ x: number; y: number }>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    importance: text("importance"),
    migration: jsonb("migration").$type<{ source: string; migratedAt: string }>(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("universe_nodes_user_updated_idx").on(table.userId, table.updatedAt.desc()),
    check("universe_nodes_position_object", sql`jsonb_typeof(${table.position}) = 'object'`),
    check(
      "universe_nodes_galaxy_memberships_array",
      sql`jsonb_typeof(${table.galaxyMemberships}) = 'array'`,
    ),
    check(
      "universe_nodes_legacy_galaxies_empty",
      sql`cardinality(${table.galaxies}) = 0`,
    ),
  ],
);

export const universeDiarySources = pgTable(
  "universe_diary_sources",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    nodeId: text("node_id").notNull(),
    diaryId: uuid("diary_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.nodeId, table.diaryId] }),
    foreignKey({
      columns: [table.userId, table.nodeId],
      foreignColumns: [universeNodes.userId, universeNodes.id],
      name: "universe_diary_sources_node_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.userId, table.diaryId],
      foreignColumns: [diaryEntries.userId, diaryEntries.id],
      name: "universe_diary_sources_diary_fk",
    }).onDelete("cascade").onUpdate("cascade"),
  ],
);

export const universeRelations = pgTable(
  "universe_relations",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    source: text("source").notNull(),
    target: text("target").notNull(),
    relationType: text("relation_type").notNull(),
    strength: doublePrecision("strength").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("universe_relations_user_source_target_type_uidx").on(
      table.userId,
      table.source,
      table.target,
      table.relationType,
    ),
    index("universe_relations_user_nodes_idx").on(table.userId, table.source, table.target),
    check(
      "universe_relations_type_allowed",
      sql`${table.relationType} IN ('related_to', 'supports', 'contradicts', 'extends', 'part_of', 'raises')`,
    ),
  ],
);

export const universeRevisions = pgTable(
  "universe_revisions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    nodeId: text("node_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("universe_revisions_user_node_created_idx").on(
      table.userId,
      table.nodeId,
      table.createdAt.desc(),
    ),
    check("universe_revisions_snapshot_object", sql`jsonb_typeof(${table.snapshot}) = 'object'`),
  ],
);

export const universeBackups = pgTable(
  "universe_backups",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("universe_backups_user_created_idx").on(table.userId, table.createdAt.desc()),
    check("universe_backups_data_object", sql`jsonb_typeof(${table.data}) = 'object'`),
    check("universe_backups_no_recursive_backups", sql`NOT (${table.data} ? 'backups')`),
  ],
);

export const toyCommands = pgTable(
  "toy_commands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    action: toyCommandActionEnum("action").notNull(),
    percent: integer("percent"),
    durationSeconds: integer("duration_seconds").default(60),
    status: toyCommandStatusEnum("status").default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    error: varchar("error", { length: 500 }),
  },
  (table) => [
    index("toy_commands_claim_queue_idx").on(
      table.userId,
      table.status,
      table.expiresAt,
      table.action,
      table.createdAt,
      table.id,
    ),
    check(
      "toy_commands_action_allowed",
      sql`${table.action} IN ('set', 'stop')`,
    ),
    check(
      "toy_commands_status_allowed",
      sql`${table.status} IN ('pending', 'claimed', 'completed', 'failed', 'expired')`,
    ),
    check(
      "toy_commands_action_percent_consistency",
      sql`(${table.action} = 'set' AND ${table.percent} IS NOT NULL AND ${table.percent} BETWEEN 1 AND 50) OR (${table.action} = 'stop' AND ${table.percent} IS NULL)`,
    ),
    check(
      "toy_commands_error_length",
      sql`${table.error} IS NULL OR char_length(${table.error}) <= 500`,
    ),
    check(
      "toy_commands_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "toy_commands_duration_seconds_consistency",
      sql`(${table.action} = 'set' AND ${table.durationSeconds} BETWEEN 1 AND 1200) OR (${table.action} = 'stop' AND (${table.durationSeconds} IS NULL OR ${table.durationSeconds} = 60))`,
    ),
  ],
);
export type UserPageCopy = {
  diarySubtitle?: string;
  settingsSubtitle?: string;
  homeHeroEyebrow?: string | null;
  homeHeroTitleMode?: "auto" | "custom";
  homeHeroTitle?: string | null;
  homeHeroDescriptionMode?: "auto" | "custom";
  homeHeroDescription?: string | null;
};

export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    accentColor: varchar("accent_color", { length: 7 })
      .default("#405f4d")
      .notNull(),

    homeTitle: varchar("home_title", { length: 120 }),

    homeSubtitle: varchar("home_subtitle", { length: 240 }),

    preferredName: varchar("preferred_name", { length: 80 }),

    timezone: varchar("timezone", { length: 64 })
      .default("Asia/Shanghai")
      .notNull(),

    pageCopy: jsonb("page_copy")
      .$type<UserPageCopy>()
      .default(sql`'{}'::jsonb`)
      .notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_settings_user_unique_idx").on(table.userId),

    check(
      "user_settings_accent_color_format",
      sql`${table.accentColor} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),

    check(
      "user_settings_home_title_not_blank",
      sql`${table.homeTitle} IS NULL OR char_length(btrim(${table.homeTitle})) > 0`,
    ),

    check(
      "user_settings_home_subtitle_not_blank",
      sql`${table.homeSubtitle} IS NULL OR char_length(btrim(${table.homeSubtitle})) > 0`,
    ),

    check(
      "user_settings_preferred_name_not_blank",
      sql`${table.preferredName} IS NULL OR char_length(btrim(${table.preferredName})) > 0`,
    ),

    check(
      "user_settings_timezone_not_blank",
      sql`char_length(btrim(${table.timezone})) > 0`,
    ),
  ],
);
