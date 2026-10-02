import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
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
} from "drizzle-orm/pg-core";
import {
  users,
} from "./users.js";
import {
  diaryEntries,
} from "./diary.js";



export const universeMeta = pgTable(
  "universe_meta",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    name: text("name").notNull(),
    schemaVersion: integer("schema_version").default(2).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    version: integer("version").default(0).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId] }),
    check("universe_meta_schema_version", sql`${table.schemaVersion} = 2`),
    check("universe_meta_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const universeGalaxies = pgTable(
  "universe_galaxies",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    color: text("color").notNull(),
    order: doublePrecision("order").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.id] })],
);

export const universeNodes = pgTable(
  "universe_nodes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    content: text("content").notNull(),
    type: text("type").notNull(),
    tags: text("tags").array().default(sql`ARRAY[]::text[]`).notNull(),
    galaxies: text("galaxies").array().default(sql`ARRAY[]::text[]`).notNull(),
    galaxyMemberships: jsonb("galaxy_memberships")
      .$type<Array<{ id: string; weight: number }>>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    position: jsonb("position").$type<{ x: number; y: number }>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    importance: text("importance"),
    migration: jsonb("migration").$type<{ source: string; migratedAt: string }>(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("universe_nodes_user_updated_idx").on(table.userId, table.updatedAt.desc()),
    check("universe_nodes_position_object", sql`jsonb_typeof(${table.position}) = 'object'`),
    check(
      "universe_nodes_galaxy_memberships_array",
      sql`jsonb_typeof(${table.galaxyMemberships}) = 'array'`,
    ),
    check(
      "universe_nodes_legacy_galaxies_empty",
      sql`cardinality(${table.galaxies}) = 0`,
    ),
  ],
);

export const universeDiarySources = pgTable(
  "universe_diary_sources",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    nodeId: text("node_id").notNull(),
    diaryId: uuid("diary_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.nodeId, table.diaryId] }),
    foreignKey({
      columns: [table.userId, table.nodeId],
      foreignColumns: [universeNodes.userId, universeNodes.id],
      name: "universe_diary_sources_node_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.userId, table.diaryId],
      foreignColumns: [diaryEntries.userId, diaryEntries.id],
      name: "universe_diary_sources_diary_fk",
    }).onDelete("cascade").onUpdate("cascade"),
  ],
);

export const universeRelations = pgTable(
  "universe_relations",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    source: text("source").notNull(),
    target: text("target").notNull(),
    relationType: text("relation_type").notNull(),
    strength: doublePrecision("strength").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("universe_relations_user_source_target_type_uidx").on(
      table.userId,
      table.source,
      table.target,
      table.relationType,
    ),
    index("universe_relations_user_nodes_idx").on(table.userId, table.source, table.target),
    check(
      "universe_relations_type_allowed",
      sql`${table.relationType} IN ('related_to', 'supports', 'contradicts', 'extends', 'part_of', 'raises')`,
    ),
  ],
);

export const universeRevisions = pgTable(
  "universe_revisions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    nodeId: text("node_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("universe_revisions_user_node_created_idx").on(
      table.userId,
      table.nodeId,
      table.createdAt.desc(),
    ),
    check("universe_revisions_snapshot_object", sql`jsonb_typeof(${table.snapshot}) = 'object'`),
  ],
);

export const universeBackups = pgTable(
  "universe_backups",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("universe_backups_user_created_idx").on(table.userId, table.createdAt.desc()),
    check("universe_backups_data_object", sql`jsonb_typeof(${table.data}) = 'object'`),
    check("universe_backups_no_recursive_backups", sql`NOT (${table.data} ? 'backups')`),
  ],
);
