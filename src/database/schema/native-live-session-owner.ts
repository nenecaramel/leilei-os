import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { conversations } from "./conversation.js";

export type NativeLiveSessionOwner = "leileios" | "releasing" | "desktop";

// One row per native conversation: who may execute it, the native line
// identity, and the visible turn slot. See docs/native-session/session-owner.md.
export const nativeLiveSessionOwners = pgTable("native_live_session_owners", {
  conversationId: uuid("conversation_id").primaryKey(),
  userId: uuid("user_id").notNull(),
  owner: varchar("owner", { length: 16 }).$type<NativeLiveSessionOwner>().default("leileios").notNull(),
  // Rotates on every owner transition (today nativeSessionSource.revision).
  ownerRevision: text("owner_revision"),
  // Rotates only when the native line diverges, never on prepare.
  writerGeneration: uuid("writer_generation").notNull(),
  turnPrepareId: uuid("turn_prepare_id"),
  turnAnchorMessageId: uuid("turn_anchor_message_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  foreignKey({ name: "native_live_session_owners_conversation_user_fk", columns: [table.conversationId, table.userId],
    foreignColumns: [conversations.id, conversations.userId] }).onDelete("cascade").onUpdate("cascade"),
  check("native_live_session_owners_owner_allowed", sql`${table.owner} IN ('leileios','releasing','desktop')`),
  check("native_live_session_owners_anchor_needs_turn", sql`${table.turnAnchorMessageId} IS NULL OR ${table.turnPrepareId} IS NOT NULL`),
]);
