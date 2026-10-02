import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  users,
} from "./users.js";
import {
  contentAuthorEnum,
} from "./shared.js";


export const todoEntryKindEnum = pgEnum("todo_entry_kind", [
  "pending",
  "completed",
  "record",
]);

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
    revision: integer("revision").default(1).notNull(),
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
      "todo_entries_revision_positive",
      sql`${table.revision} >= 1`,
    ),
    check(
      "todo_entries_position_nonnegative",
      sql`${table.position} >= 0`,
    ),
  ],
);
