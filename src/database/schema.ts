import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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

export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);

export const memoryCategoryEnum = pgEnum("memory_category", [
  "profile",
  "preference",
  "goal",
  "project",
]);

export const memoryVisibilityEnum = pgEnum("memory_visibility", [
  "assistant",
  "private",
  "restricted",
]);

export const memoryStatusEnum = pgEnum("memory_status", [
  "active",
  "archived",
]);

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

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export const taskLifecycleStatusEnum = pgEnum("task_lifecycle_status", [
  "active",
  "archived",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "normal",
  "high",
  "urgent",
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

export const sharedPapers = pgTable(
  "shared_papers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    content: text("content").notNull(),
    revision: integer("revision").default(1).notNull(),
    createdBy: contentAuthorEnum("created_by").notNull(),
    updatedBy: contentAuthorEnum("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("shared_papers_id_user_unique").on(table.id, table.userId),
    index("shared_papers_user_updated_id_idx").on(table.userId, table.updatedAt.desc(), table.id.desc()),
    index("shared_papers_user_archive_updated_id_idx").on(table.userId, table.archivedAt, table.updatedAt.desc(), table.id.desc()),
    check("shared_papers_revision_positive", sql`${table.revision} >= 1`),
    check("shared_papers_title_not_blank", sql`char_length(btrim(${table.title})) > 0`),
  ],
);

export const sharedPaperEdits = pgTable(
  "shared_paper_edits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    paperId: uuid("paper_id").notNull(),
    baseRevision: integer("base_revision").notNull(),
    revision: integer("revision").notNull(),
    author: contentAuthorEnum("author").notNull(),
    target: varchar("target", { length: 16 }).default("content").notNull(),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    deletedText: text("deleted_text").notNull(),
    insertedText: text("inserted_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.paperId, table.userId],
      foreignColumns: [sharedPapers.id, sharedPapers.userId],
      name: "shared_paper_edits_paper_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("shared_paper_edits_paper_revision_uidx").on(table.paperId, table.revision),
    index("shared_paper_edits_paper_revision_idx").on(table.paperId, table.revision.desc()),
    check("shared_paper_edits_base_revision_positive", sql`${table.baseRevision} >= 1`),
    check("shared_paper_edits_revision_step", sql`${table.revision} = ${table.baseRevision} + 1`),
    check("shared_paper_edits_target_allowed", sql`${table.target} IN ('content', 'title')`),
    check("shared_paper_edits_offsets_valid", sql`${table.startOffset} >= 0 AND ${table.endOffset} >= ${table.startOffset}`),
    check("shared_paper_edits_deleted_length_matches", sql`char_length(${table.deletedText}) = ${table.endOffset} - ${table.startOffset}`),
    check("shared_paper_edits_not_noop", sql`${table.deletedText} <> ${table.insertedText}`),
  ],
);

export const coreMemories = pgTable(
  "core_memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    category: memoryCategoryEnum("category").notNull(),
    key: varchar("key", { length: 100 }).notNull(),
    content: text("content").notNull(),
    tags: varchar("tags", { length: 50 })
      .array()
      .default(sql`ARRAY[]::varchar(50)[]`)
      .notNull(),
    visibility: memoryVisibilityEnum("visibility")
      .default("assistant")
      .notNull(),
    source: varchar("source", { length: 100 }).notNull(),
    author: contentAuthorEnum("author"),
    status: memoryStatusEnum("status").default("active").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("core_memories_user_key_unique_idx").on(
      table.userId,
      table.key,
    ),
    index("core_memories_user_category_idx").on(
      table.userId,
      table.category,
    ),
    index("core_memories_read_scope_idx").on(
      table.userId,
      table.visibility,
      table.status,
      table.sortOrder,
    ),
    check(
      "core_memories_key_not_blank",
      sql`char_length(btrim(${table.key})) > 0`,
    ),
    check(
      "core_memories_content_not_blank",
      sql`char_length(btrim(${table.content})) > 0`,
    ),
    check(
      "core_memories_source_not_blank",
      sql`char_length(btrim(${table.source})) > 0`,
    ),
    check(
      "core_memories_tags_limit",
      sql`cardinality(${table.tags}) <= 20`,
    ),
    check("core_memories_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
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
        | "create_task"
        | "write_diary"
        | "write_memory"
        | "toy_set"
        | "toy_stop"
        | "write_todo_paper"
        | "append_todo_entry"
        | "update_todo_entry"
        | "delete_todo_entry"
        | "create_universe_node"
        | "create_universe_relation"
        | "create_shared_paper"
        | "edit_shared_paper"
        | "append_shared_paper"
        | "archive_shared_paper"
        | "restore_shared_paper"
        | "delete_shared_paper"
        | "add_diary_comment"
      >()
      .notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    resourceType: varchar("resource_type", { length: 32 })
      .$type<
        | "task"
        | "diary_entry"
        | "memory"
        | "toy_command"
        | "todo_paper"
        | "todo_entry"
        | "universe_node"
        | "universe_relation"
        | "shared_paper"
        | "shared_paper_edit"
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
      sql`${table.toolName} IN ('create_task', 'write_diary', 'write_memory', 'toy_set', 'toy_stop', 'write_todo_paper', 'append_todo_entry', 'update_todo_entry', 'delete_todo_entry', 'create_universe_node', 'create_universe_relation', 'create_shared_paper', 'edit_shared_paper', 'append_shared_paper', 'archive_shared_paper', 'restore_shared_paper', 'delete_shared_paper', 'add_diary_comment')`,
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
      sql`${table.resourceType} IN ('task', 'diary_entry', 'memory', 'toy_command', 'todo_paper', 'todo_entry', 'universe_node', 'universe_relation', 'shared_paper', 'shared_paper_edit', 'diary_comment')`,
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
      .$type<"memory" | "diary" | "task">()
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
      sql`${table.resourceType} IN ('memory', 'diary', 'task')`,
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

export const conversationImportRuns = pgTable(
  "conversation_import_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    parserVersion: varchar("parser_version", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).$type<ConversationImportRunStatus>().default("processing").notNull(),
    previewFingerprint: varchar("preview_fingerprint", { length: 64 }),
    summary: jsonb("summary").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    warningCount: integer("warning_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceId, table.userId],
      foreignColumns: [conversationImportSources.id, conversationImportSources.userId],
      name: "conversation_import_runs_source_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("conversation_import_runs_source_parser_executed_uidx")
      .on(table.sourceId, table.parserVersion)
      .where(sql`${table.status} = 'executed'`),
    index("conversation_import_runs_user_created_idx").on(table.userId, table.createdAt.desc(), table.id.desc()),
    check("conversation_import_runs_parser_not_blank", sql`char_length(btrim(${table.parserVersion})) > 0`),
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

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    provider: varchar("provider", { length: 32 }).$type<ConversationProvider>().notNull(),
    sourceConversationId: text("source_conversation_id").notNull(),
    title: text("title"),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    currentLeafSourceNodeId: text("current_leaf_source_node_id"),
    defaultModel: text("default_model"),
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    sourceFingerprint: varchar("source_fingerprint", { length: 64 }).notNull(),
    firstSeenImportId: uuid("first_seen_import_id").notNull(),
    lastSeenImportId: uuid("last_seen_import_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("conversations_id_user_unique").on(table.id, table.userId),
    uniqueIndex("conversations_user_provider_source_uidx").on(table.userId, table.provider, table.sourceConversationId),
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
    check("conversations_provider_allowed", sql`${table.provider} IN ('chatgpt', 'claude')`),
    check("conversations_source_id_not_blank", sql`char_length(btrim(${table.sourceConversationId})) > 0`),
    check("conversations_fingerprint_format", sql`${table.sourceFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("conversations_provider_metadata_object", sql`jsonb_typeof(${table.providerMetadata}) = 'object'`),
  ],
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    sourceNodeId: text("source_node_id").notNull(),
    sourceMessageId: text("source_message_id"),
    parentSourceNodeId: text("parent_source_node_id"),
    role: varchar("role", { length: 32 }).$type<ConversationMessageRole>().notNull(),
    rawRole: text("raw_role"),
    model: text("model"),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    isCurrentPath: boolean("is_current_path").default(false).notNull(),
    currentPathIndex: integer("current_path_index"),
    turnIndex: integer("turn_index"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    displayText: text("display_text").default("").notNull(),
    sourceFingerprint: varchar("source_fingerprint", { length: 64 }).notNull(),
    firstSeenImportId: uuid("first_seen_import_id").notNull(),
    lastSeenImportId: uuid("last_seen_import_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("conversation_messages_id_user_unique").on(table.id, table.userId),
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "conversation_messages_conversation_user_fk",
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
    index("conversation_messages_conversation_path_idx").on(table.conversationId, table.isCurrentPath, table.currentPathIndex),
    check("conversation_messages_source_node_not_blank", sql`char_length(btrim(${table.sourceNodeId})) > 0`),
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
      sql`${table.kind} IN ('text', 'thinking', 'reasoning_recap', 'tool_use', 'tool_result', 'image', 'audio', 'video', 'file', 'unknown')`,
    ),
    check("conversation_content_blocks_raw_type_not_blank", sql`char_length(btrim(${table.rawType})) > 0`),
    check(
      "conversation_content_blocks_payload_object",
      sql`${table.payload} IS NULL OR jsonb_typeof(${table.payload}) = 'object'`,
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


export type BridgeEventStatus =
  | "pending"
  | "reserved"
  | "host_sent"
  | "delivery_unknown";

export const bridgeEvents = pgTable(
  "bridge_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 32 })
      .$type<"chat" | "wake">()
      .notNull(),
    source: varchar("source", { length: 64 })
      .$type<"leileios_pwa" | "leileios_sentinel">()
      .notNull(),
    visibleText: text("visible_text").notNull(),
    modelContext: text("model_context").notNull(),
    status: varchar("status", { length: 32 })
      .$type<BridgeEventStatus>()
      .default("pending")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reservedBy: uuid("reserved_by"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    reservationExpiresAt: timestamp("reservation_expires_at", {
      withTimezone: true,
    }),
    dispatchStartedAt: timestamp("dispatch_started_at", { withTimezone: true }),
    hostSentAt: timestamp("host_sent_at", { withTimezone: true }),
    deliveryUnknownAt: timestamp("delivery_unknown_at", {
      withTimezone: true,
    }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    processingState: varchar("processing_state", { length: 32 })
      .$type<"unclaimed" | "claimed" | "completed">()
      .default("unclaimed")
      .notNull(),
    modelClaimedAt: timestamp("model_claimed_at", { withTimezone: true }),
    modelCompletedAt: timestamp("model_completed_at", { withTimezone: true }),
    deliveryReconciledAt: timestamp("delivery_reconciled_at", {
      withTimezone: true,
    }),
    retryCount: integer("retry_count").default(0).notNull(),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
  },
  (table) => [
    uniqueIndex("bridge_events_user_idempotency_key_uidx").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("bridge_events_user_status_created_id_idx").on(
      table.userId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index("bridge_events_status_host_sent_id_idx").on(
      table.status,
      table.hostSentAt,
      table.id,
    ),
    check(
      "bridge_events_kind_allowed",
      sql`${table.kind} IN ('chat', 'wake')`,
    ),
    check(
      "bridge_events_source_allowed",
      sql`${table.source} IN ('leileios_pwa', 'leileios_sentinel')`,
    ),
    check(
      "bridge_events_idempotency_key_format",
      sql`${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]{16,128}$'`,
    ),
    check(
      "bridge_events_request_hash_format",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "bridge_events_visible_text_bounds",
      sql`char_length(btrim(${table.visibleText})) > 0 AND char_length(${table.visibleText}) <= 4000`,
    ),
    check(
      "bridge_events_status_allowed",
      sql`${table.status} IN ('pending', 'reserved', 'host_sent', 'delivery_unknown')`,
    ),
    check(
      "bridge_events_retry_count_nonnegative",
      sql`${table.retryCount} >= 0`,
    ),
    check(
      "bridge_events_reserved_fields_required",
      sql`${table.status} <> 'reserved' OR (${table.reservedBy} IS NOT NULL AND ${table.reservationExpiresAt} IS NOT NULL)`,
    ),
    check(
      "bridge_events_host_sent_at_required",
      sql`${table.status} <> 'host_sent' OR ${table.hostSentAt} IS NOT NULL`,
    ),
    check(
      "bridge_events_delivery_unknown_at_required",
      sql`${table.status} <> 'delivery_unknown' OR ${table.deliveryUnknownAt} IS NOT NULL`,
    ),
    check(
      "bridge_events_processing_state_allowed",
      sql`${table.processingState} IN ('unclaimed', 'claimed', 'completed')`,
    ),
    check(
      "bridge_events_processing_state_timestamps",
      sql`(${table.processingState} = 'unclaimed' AND ${table.modelClaimedAt} IS NULL AND ${table.modelCompletedAt} IS NULL) OR (${table.processingState} = 'claimed' AND ${table.modelClaimedAt} IS NOT NULL AND ${table.modelCompletedAt} IS NULL) OR (${table.processingState} = 'completed' AND ${table.modelClaimedAt} IS NOT NULL AND ${table.modelCompletedAt} IS NOT NULL)`,
    ),
    check(
      "bridge_events_delivery_reconciled_at_allowed",
      sql`${table.deliveryReconciledAt} IS NULL OR (${table.status} = 'delivery_unknown' AND ${table.processingState} IN ('claimed', 'completed') AND ${table.modelClaimedAt} IS NOT NULL)`,
    ),
    check(
      "bridge_events_cancelled_at_allowed",
      sql`${table.cancelledAt} IS NULL OR (${table.kind} = 'wake' AND ${table.source} = 'leileios_sentinel' AND ${table.dispatchStartedAt} IS NULL AND ${table.status} IN ('pending', 'reserved'))`,
    ),
  ],
);

export type BridgeEventKind = "chat" | "wake";
export type BridgeEventSource = "leileios_pwa" | "leileios_sentinel";

export type SentinelWakeCause = "scheduled" | "wake_now" | "recovery";
export type SentinelWakeRunState =
  | "bridge_enqueued"
  | "claimed"
  | "finalized"
  | "superseded"
  | "recovery_required";
export type SentinelWakeDecision = "contact" | "quiet";

export const sentinels = pgTable(
  "sentinels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    enabled: boolean("enabled").default(false).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    policyPrompt: varchar("policy_prompt", { length: 4000 })
      .default("")
      .notNull(),
    nextWakeAt: timestamp("next_wake_at", { withTimezone: true }),
    lastValidWakeAt: timestamp("last_valid_wake_at", {
      withTimezone: true,
    }),
    wakeContextCapsule: varchar("wake_context_capsule", { length: 1024 }),
    wakeContextUpdatedAt: timestamp("wake_context_updated_at", {
      withTimezone: true,
    }),
    controlRevision: integer("control_revision").default(0).notNull(),
    activeWakeRunId: uuid("active_wake_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("sentinels_user_id_uidx").on(table.userId),
    index("sentinels_due_enabled_idle_idx")
      .on(table.nextWakeAt)
      .where(
        sql`${table.enabled} = true AND ${table.activeWakeRunId} IS NULL AND ${table.nextWakeAt} IS NOT NULL`,
      ),
    check(
      "sentinels_timezone_not_blank",
      sql`char_length(btrim(${table.timezone})) > 0`,
    ),
    check(
      "sentinels_policy_prompt_bounds",
      sql`char_length(${table.policyPrompt}) <= 4000`,
    ),
    check(
      "sentinels_wake_context_capsule_bounds",
      sql`${table.wakeContextCapsule} IS NULL OR char_length(${table.wakeContextCapsule}) <= 1024`,
    ),
    check(
      "sentinels_control_revision_nonnegative",
      sql`${table.controlRevision} >= 0`,
    ),
    check(
      "sentinels_active_wake_requires_null_next_wake",
      sql`${table.activeWakeRunId} IS NULL OR ${table.nextWakeAt} IS NULL`,
    ),
  ],
);

export const sentinelWakeRuns = pgTable(
  "sentinel_wake_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sentinelId: uuid("sentinel_id")
      .notNull()
      .references(() => sentinels.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    controlRevision: integer("control_revision").notNull(),
    cause: varchar("cause", { length: 32 })
      .$type<SentinelWakeCause>()
      .notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    bridgeEventId: uuid("bridge_event_id")
      .notNull()
      .references(() => bridgeEvents.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    state: varchar("state", { length: 32 })
      .$type<SentinelWakeRunState>()
      .default("bridge_enqueued")
      .notNull(),
    decision: varchar("decision", { length: 16 }).$type<SentinelWakeDecision>(),
    nextWakeAt: timestamp("next_wake_at", { withTimezone: true }),
    completionPayloadHash: varchar("completion_payload_hash", { length: 64 }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    failureCode: varchar("failure_code", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("sentinel_wake_runs_bridge_event_id_uidx").on(
      table.bridgeEventId,
    ),
    uniqueIndex("sentinel_wake_runs_active_sentinel_uidx")
      .on(table.sentinelId)
      .where(
        sql`${table.state} IN ('bridge_enqueued', 'claimed', 'recovery_required')`,
      ),
    index("sentinel_wake_runs_user_state_created_idx").on(
      table.userId,
      table.state,
      table.createdAt,
    ),
    index("sentinel_wake_runs_sentinel_created_idx").on(
      table.sentinelId,
      table.createdAt.desc(),
    ),
    check(
      "sentinel_wake_runs_control_revision_nonnegative",
      sql`${table.controlRevision} >= 0`,
    ),
    check(
      "sentinel_wake_runs_cause_allowed",
      sql`${table.cause} IN ('scheduled', 'wake_now', 'recovery')`,
    ),
    check(
      "sentinel_wake_runs_state_allowed",
      sql`${table.state} IN ('bridge_enqueued', 'claimed', 'finalized', 'superseded', 'recovery_required')`,
    ),
    check(
      "sentinel_wake_runs_decision_allowed",
      sql`${table.decision} IS NULL OR ${table.decision} IN ('contact', 'quiet')`,
    ),
    check(
      "sentinel_wake_runs_completion_payload_hash_format",
      sql`${table.completionPayloadHash} IS NULL OR ${table.completionPayloadHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "sentinel_wake_runs_finalized_fields_required",
      sql`(${table.state} <> 'finalized') OR (${table.decision} IS NOT NULL AND ${table.nextWakeAt} IS NOT NULL AND ${table.finalizedAt} IS NOT NULL AND ${table.completionPayloadHash} IS NOT NULL)`,
    ),
    check(
      "sentinel_wake_runs_non_finalized_fields_null",
      sql`(${table.state} = 'finalized') OR (${table.decision} IS NULL AND ${table.nextWakeAt} IS NULL AND ${table.finalizedAt} IS NULL AND ${table.completionPayloadHash} IS NULL)`,
    ),
  ],
);

export const bridgeListenerLeases = pgTable(
  "bridge_listener_leases",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    listenerInstanceId: uuid("listener_instance_id").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId] }),
    index("bridge_listener_leases_expires_idx").on(table.leaseExpiresAt),
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

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    status: taskStatusEnum("status").default("pending").notNull(),
    resumeStatus: taskStatusEnum("resume_status"),
    lifecycleStatus: taskLifecycleStatusEnum("lifecycle_status")
      .default("active")
      .notNull(),
    author: contentAuthorEnum("author"),
    priority: taskPriorityEnum("priority").default("normal").notNull(),
    dueTime: timestamp("due_time", { withTimezone: true }),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    tags: varchar("tags", { length: 50 })
      .array()
      .default(sql`ARRAY[]::varchar(50)[]`)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("tasks_user_status_due_idx").on(
      table.userId,
      table.status,
      table.dueTime,
    ),
    index("tasks_user_lifecycle_due_created_idx").on(
      table.userId,
      table.lifecycleStatus,
      table.dueTime,
      table.createdAt.desc(),
      table.id,
    ),
    index("tasks_user_due_idx").on(table.userId, table.dueTime),
    index("tasks_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    check(
      "tasks_title_not_blank",
      sql`char_length(btrim(${table.title})) > 0`,
    ),
    check(
      "tasks_description_not_blank",
      sql`char_length(btrim(${table.description})) > 0`,
    ),
    check(
      "tasks_timezone_not_blank",
      sql`char_length(btrim(${table.timezone})) > 0`,
    ),
    check(
      "tasks_timezone_format",
      sql`${table.timezone} ~ '^[A-Za-z0-9_+.-]+(/[A-Za-z0-9_+.-]+)*$'`,
    ),
    check("tasks_tags_limit", sql`cardinality(${table.tags}) <= 20`),
    check(
      "tasks_completed_at_consistency",
      sql`(${table.status} = 'completed' AND ${table.completedAt} IS NOT NULL) OR (${table.status} <> 'completed' AND ${table.completedAt} IS NULL)`,
    ),
    check(
      "tasks_resume_status_consistency",
      sql`((${table.status} IN ('pending', 'in_progress') AND ${table.resumeStatus} IS NULL) OR (${table.status} IN ('completed', 'cancelled') AND ${table.resumeStatus} IS NOT NULL AND ${table.resumeStatus} IN ('pending', 'in_progress')))`,
    ),
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
  memorySubtitle?: string;
  diarySubtitle?: string;
  taskSubtitle?: string;
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
