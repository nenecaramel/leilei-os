import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
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
