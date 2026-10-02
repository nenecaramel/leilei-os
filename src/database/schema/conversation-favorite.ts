import { sql } from "drizzle-orm";
import {
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
  type ConversationProvider,
} from "./conversation-import.js";
import {
  type ConversationMessageRole,
} from "./conversation.js";

export type ConversationFavoriteView = "default" | "all";

export const conversationFavorites = pgTable(
  "conversation_favorites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    provider: varchar("provider", { length: 32 }).$type<ConversationProvider>().notNull(),
    sourceConversationId: text("source_conversation_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    view: varchar("view", { length: 16 }).$type<ConversationFavoriteView>().default("default").notNull(),
    title: text("title"),
    note: text("note"),
    tags: jsonb("tags").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    conversationTitleSnapshot: text("conversation_title_snapshot"),
    startMessageId: uuid("start_message_id").notNull(),
    endMessageId: uuid("end_message_id").notNull(),
    startSourceNodeId: text("start_source_node_id").notNull(),
    endSourceNodeId: text("end_source_node_id").notNull(),
    messageCount: integer("message_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("conversation_favorites_id_user_unique").on(table.id, table.userId),
    index("conversation_favorites_user_created_idx").on(table.userId, table.createdAt.desc(), table.id.desc()),
    index("conversation_favorites_user_provider_created_idx").on(table.userId, table.provider, table.createdAt.desc(), table.id.desc()),
    index("conversation_favorites_user_conversation_idx").on(table.userId, table.conversationId, table.createdAt.desc()),
    check("conversation_favorites_provider_allowed", sql`${table.provider} IN ('chatgpt', 'claude')`),
    check("conversation_favorites_view_allowed", sql`${table.view} IN ('default', 'all')`),
    check("conversation_favorites_source_conversation_not_blank", sql`char_length(btrim(${table.sourceConversationId})) > 0`),
    check("conversation_favorites_start_node_not_blank", sql`char_length(btrim(${table.startSourceNodeId})) > 0`),
    check("conversation_favorites_end_node_not_blank", sql`char_length(btrim(${table.endSourceNodeId})) > 0`),
    check("conversation_favorites_message_count_bounds", sql`${table.messageCount} BETWEEN 1 AND 200`),
    check("conversation_favorites_title_bounds", sql`${table.title} IS NULL OR char_length(${table.title}) <= 200`),
    check("conversation_favorites_note_bounds", sql`${table.note} IS NULL OR char_length(${table.note}) <= 4000`),
    check("conversation_favorites_tags_array", sql`jsonb_typeof(${table.tags}) = 'array'`),
  ],
);

export const conversationFavoriteMessages = pgTable(
  "conversation_favorite_messages",
  {
    favoriteId: uuid("favorite_id").notNull(),
    userId: uuid("user_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    messageId: uuid("message_id").notNull(),
    sourceNodeId: text("source_node_id").notNull(),
    sourceMessageId: text("source_message_id"),
    role: varchar("role", { length: 32 }).$type<ConversationMessageRole>().notNull(),
    model: text("model"),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    displayText: text("display_text").default("").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.favoriteId, table.ordinal], name: "conversation_favorite_messages_pk" }),
    foreignKey({
      columns: [table.favoriteId, table.userId],
      foreignColumns: [conversationFavorites.id, conversationFavorites.userId],
      name: "conversation_favorite_messages_favorite_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("conversation_favorite_messages_favorite_message_uidx").on(table.favoriteId, table.messageId),
    index("conversation_favorite_messages_user_message_idx").on(table.userId, table.messageId),
    check("conversation_favorite_messages_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check("conversation_favorite_messages_source_node_not_blank", sql`char_length(btrim(${table.sourceNodeId})) > 0`),
    check(
      "conversation_favorite_messages_role_allowed",
      sql`${table.role} IN ('user', 'assistant', 'system', 'tool', 'reasoning', 'unknown')`,
    ),
    check("conversation_favorite_messages_snapshot_object", sql`jsonb_typeof(${table.snapshot}) = 'object'`),
  ],
);
