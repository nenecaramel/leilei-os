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

export const toolCallStatusEnum = pgEnum("tool_call_status", [
  "success",
  "rejected",
  "error",
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
    visibility: memoryVisibilityEnum("visibility")
      .default("assistant")
      .notNull(),
    source: varchar("source", { length: 100 }).notNull(),
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
