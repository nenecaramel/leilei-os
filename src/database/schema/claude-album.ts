import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
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


export const claudeAlbumPhotos = pgTable(
  "claude_album_photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    description: text("description"),
    whySaved: text("why_saved").notNull(),
    tags: text("tags").array().default(sql`ARRAY[]::text[]`).notNull(),
    sourceAttachmentId: uuid("source_attachment_id").notNull(),
    sourceMessageId: uuid("source_message_id"),
    triggerUserMessageId: uuid("trigger_user_message_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("claude_album_photos_user_object_uidx").on(
      table.userId,
      table.objectKey,
    ),
    uniqueIndex("claude_album_photos_user_source_attachment_uidx").on(
      table.userId,
      table.sourceAttachmentId,
    ),
    index("claude_album_photos_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("claude_album_photos_user_source_message_idx").on(
      table.userId,
      table.sourceMessageId,
    ),
    index("claude_album_photos_user_trigger_message_idx").on(
      table.userId,
      table.triggerUserMessageId,
      table.createdAt,
    ),
    check(
      "claude_album_photos_object_key_not_blank",
      sql`char_length(btrim(${table.objectKey})) > 0`,
    ),
    check(
      "claude_album_photos_filename_not_blank",
      sql`char_length(btrim(${table.filename})) > 0`,
    ),
    check(
      "claude_album_photos_mime_image",
      sql`lower(${table.mimeType}) LIKE 'image/%'`,
    ),
    check(
      "claude_album_photos_size_positive",
      sql`${table.sizeBytes} > 0`,
    ),
    check(
      "claude_album_photos_sha_format",
      sql`${table.sha256} ~ ('^[0-9a-f]{64}' || chr(36))`,
    ),
    check(
      "claude_album_photos_description_limit",
      sql`${table.description} IS NULL OR char_length(${table.description}) <= 2000`,
    ),
    check(
      "claude_album_photos_why_saved_bounds",
      sql`char_length(btrim(${table.whySaved})) BETWEEN 1 AND 4000`,
    ),
    check(
      "claude_album_photos_tags_limit",
      sql`cardinality(${table.tags}) <= 12`,
    ),
  ],
);
