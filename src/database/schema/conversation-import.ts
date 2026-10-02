import { sql } from "drizzle-orm";
import {
  bigint,
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
  bytea,
} from "./shared.js";

export type ConversationProvider = "chatgpt" | "claude";
export type ConversationExclusionScope = "conversation" | "branch";
export type ConversationImportRunStatus = "processing" | "executed" | "failed";

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
