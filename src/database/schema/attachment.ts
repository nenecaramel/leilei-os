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
import {
  conversationMessages,
} from "./conversation.js";

export type NativeLiveChatAttachmentKind = "image" | "file";
export type NativeLiveChatAttachmentStatus =
  | "uploading"
  | "ready"
  | "bound"
  | "failed";

export const nativeLiveChatAttachments = pgTable(
  "native_live_chat_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    objectKey: text("object_key").notNull(),
    content: bytea("content"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 16 })
      .$type<NativeLiveChatAttachmentKind>()
      .notNull(),
    status: varchar("status", { length: 16 })
      .$type<NativeLiveChatAttachmentStatus>()
      .default("uploading")
      .notNull(),
    boundMessageId: uuid("bound_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    boundAt: timestamp("bound_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("native_live_chat_attachments_user_object_uidx").on(
      table.userId,
      table.objectKey,
    ),
    index("native_live_chat_attachments_user_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index("native_live_chat_attachments_bound_message_idx").on(
      table.userId,
      table.boundMessageId,
    ),
    check(
      "native_live_chat_attachments_object_key_not_blank",
      sql`char_length(btrim(${table.objectKey})) > 0`,
    ),
    check(
      "native_live_chat_attachments_filename_not_blank",
      sql`char_length(btrim(${table.filename})) > 0`,
    ),
    check(
      "native_live_chat_attachments_mime_not_blank",
      sql`char_length(btrim(${table.mimeType})) > 0`,
    ),
    check(
      "native_live_chat_attachments_size_positive",
      sql`${table.sizeBytes} > 0`,
    ),
    check(
      "native_live_chat_attachments_sha_format",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "native_live_chat_attachments_kind_allowed",
      sql`${table.kind} IN ('image', 'file')`,
    ),
    check(
      "native_live_chat_attachments_status_allowed",
      sql`${table.status} IN ('uploading', 'ready', 'bound', 'failed')`,
    ),
    check(
      "native_live_chat_attachments_state_consistency",
      sql`(
        ${table.status} = 'uploading'
        AND ${table.readyAt} IS NULL
        AND ${table.boundAt} IS NULL
        AND ${table.failedAt} IS NULL
        AND ${table.boundMessageId} IS NULL
      ) OR (
        ${table.status} = 'ready'
        AND ${table.readyAt} IS NOT NULL
        AND ${table.boundAt} IS NULL
        AND ${table.failedAt} IS NULL
        AND ${table.boundMessageId} IS NULL
      ) OR (
        ${table.status} = 'bound'
        AND ${table.readyAt} IS NOT NULL
        AND ${table.boundAt} IS NOT NULL
        AND ${table.failedAt} IS NULL
        AND ${table.boundMessageId} IS NOT NULL
      ) OR (
        ${table.status} = 'failed'
        AND ${table.boundAt} IS NULL
        AND ${table.failedAt} IS NOT NULL
        AND ${table.boundMessageId} IS NULL
      )`,
    ),
  ],
);

export const conversationAttachments = pgTable(
  "conversation_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    messageId: uuid("message_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    sourceAttachmentId: text("source_attachment_id"),
    name: text("name"),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.messageId, table.userId],
      foreignColumns: [conversationMessages.id, conversationMessages.userId],
      name: "conversation_attachments_message_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("conversation_attachments_message_ordinal_uidx").on(table.messageId, table.ordinal),
    index("conversation_attachments_user_source_idx").on(table.userId, table.sourceAttachmentId),
    check("conversation_attachments_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check("conversation_attachments_size_nonnegative", sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`),
    check("conversation_attachments_payload_object", sql`jsonb_typeof(${table.payload}) = 'object'`),
  ],
);
