import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schemaSource = readFileSync(
  new URL("../src/database/schema.ts", import.meta.url),
  "utf8",
);
const migrationSql = readFileSync(
  new URL("../drizzle/0040_conversation_archive_core.sql", import.meta.url),
  "utf8",
);
const journal = JSON.parse(readFileSync(
  new URL("../drizzle/meta/_journal.json", import.meta.url),
  "utf8",
)) as { entries: Array<{ idx: number; tag: string; when: number }> };
const previousSnapshot = JSON.parse(readFileSync(
  new URL("../drizzle/meta/0039_snapshot.json", import.meta.url),
  "utf8",
)) as { id: string };
const snapshot = JSON.parse(readFileSync(
  new URL("../drizzle/meta/0040_snapshot.json", import.meta.url),
  "utf8",
)) as { id: string; prevId: string; tables: Record<string, unknown> };
const blobMigrationSql = readFileSync(
  new URL("../drizzle/0041_conversation_import_blobs.sql", import.meta.url),
  "utf8",
);
const blobSnapshot = JSON.parse(readFileSync(
  new URL("../drizzle/meta/0041_snapshot.json", import.meta.url),
  "utf8",
)) as { id: string; prevId: string; tables: Record<string, unknown> };
const exclusionMigrationSql = readFileSync(
  new URL("../drizzle/0042_conversation_exclusions.sql", import.meta.url),
  "utf8",
);
const exclusionSnapshot = JSON.parse(readFileSync(
  new URL("../drizzle/meta/0042_snapshot.json", import.meta.url),
  "utf8",
)) as { id: string; prevId: string; tables: Record<string, unknown> };
const favoriteMigrationSql = readFileSync(
  new URL("../drizzle/0043_conversation_favorites.sql", import.meta.url),
  "utf8",
);
const favoriteSnapshot = JSON.parse(readFileSync(
  new URL("../drizzle/meta/0043_snapshot.json", import.meta.url),
  "utf8",
)) as { id: string; prevId: string; tables: Record<string, unknown> };
const reapplyMigrationSql = readFileSync(
  new URL("../drizzle/0044_conversation_import_reapply.sql", import.meta.url),
  "utf8",
);
const reapplySnapshot = JSON.parse(readFileSync(
  new URL("../drizzle/meta/0044_snapshot.json", import.meta.url),
  "utf8",
)) as { prevId: string; tables: Record<string, unknown> };
const lifecycleMigrationSql = readFileSync(
  new URL("../drizzle/0045_conversation_lifecycle.sql", import.meta.url),
  "utf8",
);
const lifecycleSnapshot = JSON.parse(readFileSync(
  new URL("../drizzle/meta/0045_snapshot.json", import.meta.url),
  "utf8",
)) as { prevId: string; tables: Record<string, unknown> };

test("Conversation Archive migrations form the checked-in journal tail", () => {
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.equal(blobSnapshot.prevId, snapshot.id);
  assert.equal(exclusionSnapshot.prevId, blobSnapshot.id);
  assert.equal(favoriteSnapshot.prevId, exclusionSnapshot.id);
  assert.equal(reapplySnapshot.prevId, favoriteSnapshot.id);
  assert.equal(lifecycleSnapshot.prevId, reapplySnapshot.id);
  const latest = journal.entries.at(-1);
  assert.deepEqual(latest, {
    idx: 45,
    version: "7",
    when: 1789756800000,
    tag: "0045_conversation_lifecycle",
    breakpoints: true,
  });
});

test("Conversation lifecycle columns and deleted-branch tombstones are additive and user scoped", () => {
  assert.match(schemaSource, /archivedAt: timestamp\("archived_at"/);
  assert.match(schemaSource, /deletedAt: timestamp\("deleted_at"/);
  assert.match(schemaSource, /export const conversationDeletedBranches = pgTable/);
  assert.match(lifecycleMigrationSql, /ADD COLUMN "archived_at"/);
  assert.match(lifecycleMigrationSql, /ADD COLUMN "deleted_at"/);
  assert.match(lifecycleMigrationSql, /CREATE TABLE "conversation_deleted_branches"/);
  assert.match(lifecycleMigrationSql, /ON DELETE cascade/);
  assert.ok(lifecycleSnapshot.tables["public.conversation_deleted_branches"]);
});

test("Conversation Archive schema and migration contain the seven core persistence tables", () => {
  const tables = [
    "conversation_import_sources",
    "conversation_import_runs",
    "conversations",
    "conversation_messages",
    "conversation_content_blocks",
    "conversation_attachments",
    "conversation_message_versions",
  ];
  for (const name of tables) {
    assert.match(schemaSource, new RegExp(`pgTable\\(\\s*"${name}"`));
    assert.match(migrationSql, new RegExp(`CREATE TABLE "${name}"`));
    assert.ok(snapshot.tables[`public.${name}`], `snapshot missing ${name}`);
  }
});

test("source and import-run ownership are safe for composite foreign keys", () => {
  assert.match(migrationSql, /CONSTRAINT "conversation_import_sources_id_user_unique" UNIQUE\("id","user_id"\)/);
  assert.match(migrationSql, /CONSTRAINT "conversation_import_runs_id_user_unique" UNIQUE\("id","user_id"\)/);
  assert.match(migrationSql, /"conversation_import_runs_source_user_fk" FOREIGN KEY \("source_id","user_id"\)/);
});

test("canonical conversation identity is provider-scoped and message nodes remain branch-addressable", () => {
  assert.match(migrationSql, /"conversations_user_provider_source_uidx"[^;]*\("user_id","provider","source_conversation_id"\)/);
  assert.match(migrationSql, /"conversation_messages_conversation_node_uidx"[^;]*\("conversation_id","source_node_id"\)/);
  assert.match(migrationSql, /"conversation_messages_conversation_source_message_uidx"[^;]*WHERE "conversation_messages"."source_message_id" IS NOT NULL/);
});

test("current path and ordinary message metadata are constrained without deleting hidden branches", () => {
  assert.match(migrationSql, /"conversation_messages_current_path_index_uidx"[^;]*WHERE "conversation_messages"."is_current_path" = true/);
  assert.match(migrationSql, /"conversation_messages_path_consistency"/);
  assert.doesNotMatch(migrationSql, /DELETE FROM "conversation_messages"/);
});

test("message versions preserve changed canonical records", () => {
  assert.match(schemaSource, /export const conversationMessageVersions = pgTable/);
  assert.match(migrationSql, /"previous_fingerprint" varchar\(64\) NOT NULL/);
  assert.match(migrationSql, /"snapshot" jsonb NOT NULL/);
  assert.match(migrationSql, /"replaced_by_import_id" uuid NOT NULL/);
});


test("raw Conversation source blobs are persisted behind source ownership", () => {
  assert.match(schemaSource, /export const conversationImportBlobs = pgTable/);
  assert.match(blobMigrationSql, /CREATE TABLE "conversation_import_blobs"/);
  assert.match(blobMigrationSql, /"data" bytea NOT NULL/);
  assert.match(
    blobMigrationSql,
    /"conversation_import_blobs_source_user_fk" FOREIGN KEY \("source_id","user_id"\)/,
  );
  assert.ok(blobSnapshot.tables["public.conversation_import_blobs"]);
});


test("Conversation exclusion rules are provider/source-addressed and distinguish whole windows from branches", () => {
  assert.match(schemaSource, /export const conversationExclusions = pgTable/);
  assert.match(exclusionMigrationSql, /CREATE TABLE "conversation_exclusions"/);
  assert.match(
    exclusionMigrationSql,
    /"conversation_exclusions_conversation_uidx"[^;]*WHERE "conversation_exclusions"."scope" = 'conversation'/,
  );
  assert.match(
    exclusionMigrationSql,
    /"conversation_exclusions_branch_uidx"[^;]*WHERE "conversation_exclusions"."scope" = 'branch' AND "conversation_exclusions"."source_node_id" IS NOT NULL/,
  );
  assert.match(exclusionMigrationSql, /"conversation_exclusions_scope_node_consistency"/);
  assert.ok(exclusionSnapshot.tables["public.conversation_exclusions"]);
});


test("Conversation favorites preserve canonical refs without cascading from canonical message deletion", () => {
  assert.match(schemaSource, /export const conversationFavorites = pgTable/);
  assert.match(schemaSource, /export const conversationFavoriteMessages = pgTable/);
  assert.match(favoriteMigrationSql, /CREATE TABLE "conversation_favorites"/);
  assert.match(favoriteMigrationSql, /CREATE TABLE "conversation_favorite_messages"/);
  assert.match(favoriteMigrationSql, /"snapshot" jsonb NOT NULL/);
  assert.match(favoriteMigrationSql, /"conversation_favorite_messages_user_message_idx"/);
  assert.doesNotMatch(
    favoriteMigrationSql,
    /FOREIGN KEY \("message_id"\).*conversation_messages/,
  );
  assert.doesNotMatch(
    favoriteMigrationSql,
    /FOREIGN KEY \("conversation_id"\).*conversations/,
  );
  assert.ok(favoriteSnapshot.tables["public.conversation_favorites"]);
  assert.ok(favoriteSnapshot.tables["public.conversation_favorite_messages"]);
});

test("Conversation favorite metadata and range sizes are database constrained", () => {
  assert.match(favoriteMigrationSql, /"conversation_favorites_message_count_bounds"/);
  assert.match(favoriteMigrationSql, /BETWEEN 1 AND 200/);
  assert.match(favoriteMigrationSql, /"conversation_favorites_title_bounds"/);
  assert.match(favoriteMigrationSql, /"conversation_favorites_note_bounds"/);
  assert.match(favoriteMigrationSql, /"conversation_favorites_tags_array"/);
  assert.match(
    favoriteMigrationSql,
    /"conversation_favorite_messages_favorite_user_fk" FOREIGN KEY \("favorite_id","user_id"\)/,
  );
});


test("Conversation reapply migration scopes executed-run idempotency by explicit execution key", () => {
  assert.match(
    reapplyMigrationSql,
    /ADD COLUMN "execution_key" varchar\(64\) DEFAULT 'standard' NOT NULL/,
  );
  assert.match(
    reapplyMigrationSql,
    /DROP INDEX IF EXISTS "conversation_import_runs_source_parser_executed_uidx"/,
  );
  assert.match(
    reapplyMigrationSql,
    /"conversation_import_runs_execution_executed_uidx"[\s\S]*"source_id"[\s\S]*"parser_version"[\s\S]*"preview_fingerprint"[\s\S]*"execution_key"/,
  );
  assert.match(
    reapplyMigrationSql,
    /conversation_import_runs_execution_key_not_blank/,
  );
  const runTable = reapplySnapshot.tables["public.conversation_import_runs"] as {
    columns?: Record<string, unknown>;
    indexes?: Record<string, unknown>;
    checkConstraints?: Record<string, unknown>;
  };
  assert.ok(runTable.columns?.execution_key);
  assert.ok(runTable.indexes?.conversation_import_runs_execution_executed_uidx);
  assert.ok(runTable.checkConstraints?.conversation_import_runs_execution_key_not_blank);
});
