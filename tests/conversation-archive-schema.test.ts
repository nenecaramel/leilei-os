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
)) as { prevId: string; tables: Record<string, unknown> };

test("Conversation Archive migrations form the checked-in journal tail", () => {
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.equal(blobSnapshot.prevId, snapshot.id);
  assert.equal(exclusionSnapshot.prevId, blobSnapshot.id);
  const latest = journal.entries.at(-1);
  assert.deepEqual(latest, {
    idx: 42,
    version: "7",
    when: 1789541400000,
    tag: "0042_conversation_exclusions",
    breakpoints: true,
  });
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
