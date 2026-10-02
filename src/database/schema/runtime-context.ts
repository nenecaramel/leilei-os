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
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  conversations,
  conversationMessages,
} from "./conversation.js";


export const runtimeContextManifests = pgTable(
  "runtime_context_manifests",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    subjectId: text("subject_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    pathHeadMessageId: uuid("path_head_message_id"),
    snapshotSequence: integer("snapshot_sequence").notNull(),
    assemblyVersion: varchar("assembly_version", { length: 64 }).notNull(),
    promptContractVersion: varchar("prompt_contract_version", { length: 64 }).notNull(),
    lineage: jsonb("lineage").$type<Record<string, unknown> | null>(),
    budget: jsonb("budget").$type<Record<string, unknown>>().notNull(),
    items: jsonb("items").$type<Record<string, unknown>[]>().notNull(),
    assembledAt: timestamp("assembled_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "runtime_context_manifests_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.pathHeadMessageId, table.conversationId, table.userId],
      foreignColumns: [
        conversationMessages.id,
        conversationMessages.conversationId,
        conversationMessages.userId,
      ],
      name: "runtime_context_manifests_head_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    index("runtime_context_manifests_user_subject_created_idx").on(
      table.userId,
      table.subjectId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check("runtime_context_manifests_subject_not_blank", sql`char_length(btrim(${table.subjectId})) > 0`),
    check("runtime_context_manifests_snapshot_nonnegative", sql`${table.snapshotSequence} >= 0`),
    check("runtime_context_manifests_assembly_not_blank", sql`char_length(btrim(${table.assemblyVersion})) > 0`),
    check("runtime_context_manifests_prompt_not_blank", sql`char_length(btrim(${table.promptContractVersion})) > 0`),
    check("runtime_context_manifests_budget_object", sql`jsonb_typeof(${table.budget}) = 'object'`),
    check("runtime_context_manifests_items_array", sql`jsonb_typeof(${table.items}) = 'array'`),
  ],
);

export const runtimeContextLineageStates = pgTable(
  "runtime_context_lineage_states",
  {
    canonicalMessageId: uuid("canonical_message_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    epoch: integer("epoch").default(0).notNull(),
    seenStateIds: jsonb("seen_state_ids")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    thoughtRevision: integer("thought_revision").default(0).notNull(),
    thoughtFingerprint: varchar("thought_fingerprint", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [
        table.canonicalMessageId,
        table.conversationId,
        table.userId,
      ],
      foreignColumns: [
        conversationMessages.id,
        conversationMessages.conversationId,
        conversationMessages.userId,
      ],
      name: "runtime_context_lineage_states_message_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    index("runtime_context_lineage_states_user_conversation_idx").on(
      table.userId,
      table.conversationId,
      table.updatedAt.desc(),
    ),
    check(
      "runtime_context_lineage_states_epoch_nonnegative",
      sql`${table.epoch} >= 0`,
    ),
    check(
      "runtime_context_lineage_states_seen_array",
      sql`jsonb_typeof(${table.seenStateIds}) = 'array'`,
    ),
    check(
      "runtime_context_lineage_states_thought_revision_nonnegative",
      sql`${table.thoughtRevision} >= 0`,
    ),
    check(
      "runtime_context_lineage_states_thought_fingerprint_format",
      sql`${table.thoughtFingerprint} IS NULL OR ${table.thoughtFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const runtimeDistillationWatermarks = pgTable(
  "runtime_distillation_watermarks",
  {
    userId: uuid("user_id").notNull(),
    subjectId: text("subject_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    lastSourceMessageId: uuid("last_source_message_id").notNull(),
    processVersion: varchar("process_version", { length: 64 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.subjectId, table.conversationId],
      name: "runtime_distillation_watermarks_pk",
    }),
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
      name: "runtime_distillation_watermarks_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.lastSourceMessageId, table.conversationId, table.userId],
      foreignColumns: [
        conversationMessages.id,
        conversationMessages.conversationId,
        conversationMessages.userId,
      ],
      name: "runtime_distillation_watermarks_message_conversation_user_fk",
    }).onDelete("cascade").onUpdate("cascade"),
    check(
      "runtime_distillation_watermarks_subject_not_blank",
      sql`char_length(btrim(${table.subjectId})) > 0`,
    ),
    check(
      "runtime_distillation_watermarks_process_not_blank",
      sql`char_length(btrim(${table.processVersion})) > 0`,
    ),
  ],
);
