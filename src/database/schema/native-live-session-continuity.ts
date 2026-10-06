import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { conversations, conversationMessages } from "./conversation.js";

// These existing durable tables were previously declared only in the ledger.
// Declare them here as well so fresh schemas retain the same continuity evidence.
export const nativeLiveExternalSessionRequests = pgTable("native_live_external_session_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  reservedBy: uuid("reserved_by"),
  reservedAt: timestamp("reserved_at", { withTimezone: true }),
  reservationExpiresAt: timestamp("reservation_expires_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  result: jsonb("result"),
  failureCode: varchar("failure_code", { length: 64 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index("native_live_external_session_requests_queue_idx").on(table.userId, table.status, table.createdAt, table.id),
  check("native_live_external_session_requests_status_allowed", sql`${table.status} IN ('pending','reserved','completed','failed','expired')`),
  check("native_live_external_session_requests_result_array", sql`${table.result} IS NULL OR jsonb_typeof(${table.result}) = 'array'`),
]);

export const nativeLiveConversationProviderBootstraps = pgTable("native_live_conversation_provider_bootstraps", {
  conversationId: uuid("conversation_id").primaryKey(),
  userId: uuid("user_id").notNull(),
  provider: varchar("provider", { length: 32 }).default("claude_code").notNull(),
  sourceProviderSessionId: text("source_provider_session_id").notNull(),
  effectiveWorkingDirectory: text("effective_working_directory").notNull(),
  sourceRequestId: uuid("source_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, table => [
  foreignKey({ name: "native_live_conversation_provider_bootstraps_conversation_user_fk", columns: [table.conversationId, table.userId], foreignColumns: [conversations.id, conversations.userId] }).onDelete("cascade").onUpdate("cascade"),
  foreignKey({ name: "native_live_conversation_provider_bootstraps_request_fk", columns: [table.sourceRequestId], foreignColumns: [nativeLiveExternalSessionRequests.id] }).onDelete("set null").onUpdate("cascade"),
  index("native_live_conversation_provider_bootstraps_user_idx").on(table.userId, table.createdAt, table.conversationId),
  check("native_live_conversation_provider_bootstraps_provider_allowed", sql`${table.provider} = 'claude_code'`),
  check("native_live_conversation_provider_bootstraps_session_not_blank", sql`char_length(btrim(${table.sourceProviderSessionId})) > 0`),
  check("native_live_conversation_provider_bootstraps_root_not_blank", sql`char_length(btrim(${table.effectiveWorkingDirectory})) > 0`),
]);

export const nativeLiveManualCompactions = pgTable("native_live_manual_compactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  expectedHeadMessageId: uuid("expected_head_message_id").notNull(),
  sourceMessageId: uuid("source_message_id").notNull(),
  providerSessionId: text("provider_session_id").notNull(),
  effectiveWorkingDirectory: text("effective_working_directory"),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  reservedBy: uuid("reserved_by"),
  reservedAt: timestamp("reserved_at", { withTimezone: true }),
  reservationExpiresAt: timestamp("reservation_expires_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  result: jsonb("result"),
  failureCode: varchar("failure_code", { length: 64 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  foreignKey({ name: "native_live_manual_compactions_user_fk", columns: [table.userId], foreignColumns: [users.id] }).onDelete("cascade").onUpdate("cascade"),
  foreignKey({ name: "native_live_manual_compactions_conversation_user_fk", columns: [table.conversationId, table.userId], foreignColumns: [conversations.id, conversations.userId] }).onDelete("cascade").onUpdate("cascade"),
  foreignKey({ name: "native_live_manual_compactions_source_message_user_fk", columns: [table.sourceMessageId, table.conversationId, table.userId], foreignColumns: [conversationMessages.id, conversationMessages.conversationId, conversationMessages.userId] }).onDelete("cascade").onUpdate("cascade"),
  uniqueIndex("native_live_manual_compactions_active_uidx").on(table.userId, table.conversationId).where(sql`${table.status} IN ('pending','reserved')`),
  index("native_live_manual_compactions_queue_idx").on(table.userId, table.status, table.createdAt, table.id),
  check("native_live_manual_compactions_provider_session_not_blank", sql`char_length(btrim(${table.providerSessionId})) > 0`),
  check("native_live_manual_compactions_working_directory_not_blank", sql`${table.effectiveWorkingDirectory} IS NULL OR char_length(btrim(${table.effectiveWorkingDirectory})) > 0`),
  check("native_live_manual_compactions_result_object", sql`${table.result} IS NULL OR jsonb_typeof(${table.result}) = 'object'`),
  check("native_live_manual_compactions_status_allowed", sql`${table.status} IN ('pending','reserved','completed','failed','stale','expired')`),
]);
