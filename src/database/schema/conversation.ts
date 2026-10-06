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
  users,
} from "./users.js";
import {
  conversationImportRuns,
  type ConversationProvider,
} from "./conversation-import.js";

export type ConversationOrigin = "legacy_import" | "native_live";
export type ConversationLifecycleStatus = "active" | "archived" | "deleted";
export type ConversationMessageStatus = "pending" | "streaming" | "completed" | "error";
export type ConversationRuntimeProvider = "claude_code";
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
    effectiveWorkingDirectory: text("effective_working_directory"),
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
      "conversation_provider_checkpoints_directory_not_blank",
      sql`${table.effectiveWorkingDirectory} IS NULL OR char_length(btrim(${table.effectiveWorkingDirectory})) > 0`,
    ),
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
