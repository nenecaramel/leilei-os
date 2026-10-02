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
  conversations,
} from "./conversation.js";

export type ProjectResourceKind =
  | "file"
  | "instructions"
  | "settings"
  | "skill"
  | "agent"
  | "mcp"
  | "hook"
  | "plugin";

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    description: text("description"),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("workspaces_id_user_unique").on(table.id, table.userId),
    index("workspaces_user_updated_idx").on(
      table.userId,
      table.updatedAt.desc(),
      table.id.desc(),
    ),
    check(
      "workspaces_name_not_blank",
      sql`char_length(btrim(${table.name})) > 0`,
    ),
    check(
      "workspaces_name_length",
      sql`char_length(${table.name}) <= 200`,
    ),
    check(
      "workspaces_description_length",
      sql`${table.description} IS NULL OR char_length(${table.description}) <= 4000`,
    ),
    check(
      "workspaces_version_positive",
      sql`${table.version} >= 1`,
    ),
  ],
);

export const workspaceResources = pgTable(
  "workspace_resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    kind: varchar("kind", { length: 32 })
      .$type<ProjectResourceKind>()
      .notNull(),
    resourceKey: text("resource_key").notNull(),
    title: text("title"),
    content: text("content"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaces.id, workspaces.userId],
      name: "workspace_resources_workspace_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    uniqueIndex("workspace_resources_workspace_kind_key_uidx").on(
      table.workspaceId,
      table.kind,
      table.resourceKey,
    ),
    index("workspace_resources_user_workspace_kind_idx").on(
      table.userId,
      table.workspaceId,
      table.kind,
      table.updatedAt.desc(),
      table.id.desc(),
    ),
    check(
      "workspace_resources_kind_allowed",
      sql`${table.kind} IN ('file','instructions','settings','skill','agent','mcp','hook','plugin')`,
    ),
    check(
      "workspace_resources_key_not_blank",
      sql`char_length(btrim(${table.resourceKey})) > 0`,
    ),
    check(
      "workspace_resources_key_length",
      sql`char_length(${table.resourceKey}) <= 1000`,
    ),
    check(
      "workspace_resources_title_length",
      sql`${table.title} IS NULL OR char_length(${table.title}) <= 500`,
    ),
    check(
      "workspace_resources_content_length",
      sql`${table.content} IS NULL OR char_length(${table.content}) <= 1000000`,
    ),
    check(
      "workspace_resources_metadata_object",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
    check(
      "workspace_resources_version_positive",
      sql`${table.version} >= 1`,
    ),
  ],
);

export const workspaceConversations = pgTable(
  "workspace_conversations",
  {
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.conversationId],
      name: "workspace_conversations_pk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaces.id, workspaces.userId],
      name: "workspace_conversations_workspace_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "workspace_conversations_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    index("workspace_conversations_user_workspace_added_idx").on(
      table.userId,
      table.workspaceId,
      table.addedAt.desc(),
      table.conversationId.desc(),
    ),
  ],
);
