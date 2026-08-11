import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
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

export const contentAuthorEnum = pgEnum("content_author", ["L", "G"]);

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
      .$type<"create_task" | "write_diary" | "write_memory" | "toy_set" | "toy_stop">()
      .notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    resourceType: varchar("resource_type", { length: 32 })
      .$type<"task" | "diary_entry" | "memory" | "toy_command">()
      .notNull(),
    resourceId: uuid("resource_id").notNull(),
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
    check(
      "mcp_write_idempotency_tool_allowed",
      sql`${table.toolName} IN ('create_task', 'write_diary', 'write_memory', 'toy_set', 'toy_stop')`,
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
      sql`${table.resourceType} IN ('task', 'diary_entry', 'memory', 'toy_command')`,
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
      sql`(${table.action} = 'set' AND ${table.percent} IS NOT NULL AND ${table.percent} BETWEEN 1 AND 40) OR (${table.action} = 'stop' AND ${table.percent} IS NULL)`,
    ),
    check(
      "toy_commands_error_length",
      sql`${table.error} IS NULL OR char_length(${table.error}) <= 500`,
    ),
    check(
      "toy_commands_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);
export const healthRecords = pgTable(
  "health_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    date: date("date", { mode: "string" }).notNull(),

    steps: integer("steps"),

    periodStartDate: date("period_start_date", {
      mode: "string",
    }),

    cycleDay: integer("cycle_day"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("health_records_user_date_idx").on(
      table.userId,
      table.date.desc(),
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
