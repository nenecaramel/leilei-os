import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
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
  contentAuthorEnum,
} from "./shared.js";


export const diarySourceEnum = pgEnum("diary_source", ["chatgpt_mcp"]);

export const diaryStatusEnum = pgEnum("diary_status", [
  "active",
  "archived",
]);

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

export const diaryComments = pgTable(
  "diary_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    diaryId: uuid("diary_id").notNull(),
    author: contentAuthorEnum("author").notNull(),
    content: text("content").notNull(),
    revision: integer("revision").default(1).notNull(),
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
    foreignKey({
      columns: [table.userId, table.diaryId],
      foreignColumns: [diaryEntries.userId, diaryEntries.id],
      name: "diary_comments_user_diary_fk",
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    uniqueIndex("diary_comments_user_idempotency_unique_idx").on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex("diary_comments_user_id_id_uidx").on(
      table.userId,
      table.id,
    ),
    index("diary_comments_user_diary_created_id_idx").on(
      table.userId,
      table.diaryId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check(
      "diary_comments_content_not_blank",
      sql`char_length(btrim(${table.content})) > 0`,
    ),
    check(
      "diary_comments_content_limit",
      sql`char_length(${table.content}) <= 10000`,
    ),
    check(
      "diary_comments_revision_positive",
      sql`${table.revision} >= 1`,
    ),
    check(
      "diary_comments_idempotency_key_format",
      sql`${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]{16,128}$'`,
    ),
    check(
      "diary_comments_request_hash_format",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
