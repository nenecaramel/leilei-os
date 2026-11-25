import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  users,
} from "./users.js";
import {
  type ConversationProvider,
} from "./conversation-import.js";

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
