import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
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
import {
  diaryEntries,
} from "./diary.js";

export const toolCallStatusEnum = pgEnum("tool_call_status", [
  "success",
  "rejected",
  "error",
]);

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
        | "write_memory"
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
        | "mind_state"
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
      sql`${table.toolName} IN ('write_memory', 'write_diary', 'toy_set', 'toy_stop', 'write_todo_paper', 'append_todo_entry', 'update_todo_entry', 'delete_todo_entry', 'create_universe_node', 'create_universe_relation', 'add_diary_comment')`,
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
      sql`${table.resourceType} IN ('mind_state', 'diary_entry', 'toy_command', 'todo_paper', 'todo_entry', 'universe_node', 'universe_relation', 'diary_comment')`,
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
        | "mind_manual_create"
      >()
      .notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    resourceType: varchar("resource_type", { length: 32 })
      .$type<"mind_state">()
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
      sql`${table.operation} IN ('mind_manual_create')`,
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
      sql`${table.resourceType} IN ('mind_state')`,
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
