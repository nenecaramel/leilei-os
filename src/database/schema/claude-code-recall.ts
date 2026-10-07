import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const claudeCodeRecallReceipts = pgTable("claude_code_recall_receipts", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, {onDelete: "cascade"}),
  subjectId: text("subject_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  contextEpoch: integer("context_epoch").notNull(),
  stateIds: uuid("state_ids").array().notNull(),
  contextSha256: text("context_sha256").notNull(),
  recalledAt: timestamp("recalled_at", {withTimezone: true}).notNull(),
  expiresAt: timestamp("expires_at", {withTimezone: true}).notNull(),
  confirmedAt: timestamp("confirmed_at", {withTimezone: true}),
}, table => [
  index("claude_code_recall_expiry_idx").on(table.expiresAt),
  check("claude_code_recall_epoch_nonnegative", sql`${table.contextEpoch} >= 0`),
  check("claude_code_recall_hash_valid", sql`${table.contextSha256} ~ '^[a-f0-9]{64}$'`),
  check("claude_code_recall_ids_bounded", sql`cardinality(${table.stateIds}) BETWEEN 1 AND 4`),
  check("claude_code_recall_scope_valid", sql`${table.conversationId} LIKE 'claude-code:%' AND length(${table.conversationId}) BETWEEN 13 AND 268 AND length(btrim(${table.subjectId})) > 0`),
  check("claude_code_recall_expiry_valid", sql`${table.expiresAt} = ${table.recalledAt} + interval '24 hours'`),
]);
