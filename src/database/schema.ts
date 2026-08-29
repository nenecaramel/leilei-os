import { sql } from "drizzle-orm";
import {
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
      "todo_entries_position_nonnegative",
      sql`${table.position} >= 0`,
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
        | "create_universe_node"
        | "create_universe_relation"
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
        | "universe_node"
        | "universe_relation"
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
      sql`${table.toolName} IN ('create_task', 'write_diary', 'write_memory', 'toy_set', 'toy_stop', 'write_todo_paper', 'create_universe_node', 'create_universe_relation')`,
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
      sql`${table.resourceType} IN ('task', 'diary_entry', 'memory', 'toy_command', 'todo_paper', 'universe_node', 'universe_relation')`,
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
    kind: varchar("kind", { length: 32 }).$type<"chat">().notNull(),
    source: varchar("source", { length: 64 })
      .$type<"leileios_pwa">()
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
      sql`${table.kind} = 'chat'`,
    ),
    check(
      "bridge_events_source_allowed",
      sql`${table.source} = 'leileios_pwa'`,
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
