import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("drizzle/0034_wealthy_amazoness.sql", "utf8");
const lifecycleMigration = readFileSync("drizzle/0035_shared_paper_lifecycle.sql", "utf8");
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: Array<{ idx: number; tag: string }> };

test("Shared Paper migration adds canonical paper/edit tables and bounded constraints", () => {
  assert.match(migration, /CREATE TABLE "shared_papers"/);
  assert.match(migration, /CREATE TABLE "shared_paper_edits"/);
  assert.match(migration, /shared_paper_edits_paper_user_fk/);
  assert.match(migration, /CONSTRAINT "shared_papers_id_user_unique" UNIQUE\("id","user_id"\)/);
  assert.ok(
    migration.indexOf('CONSTRAINT "shared_papers_id_user_unique"')
      < migration.indexOf('shared_paper_edits_paper_user_fk'),
  );
  assert.match(migration, /shared_paper_edits_revision_step/);
  assert.match(migration, /shared_paper_edits_deleted_length_matches/);
  assert.match(migration, /shared_paper_edits_not_noop/);
  assert.match(migration, /shared_papers_user_updated_id_idx/);
  assert.match(migration, /shared_paper_edits_paper_revision_idx/);
  assert.match(migration, /create_shared_paper/);
  assert.match(migration, /edit_shared_paper/);
  assert.match(migration, /shared_paper_edit/);
});

test("Shared Paper lifecycle migration is the current journal tail", () => {
  const tail = journal.entries.at(-1);
  assert.equal(journal.entries.filter((entry) => entry.idx === 34).length, 1);
  assert.equal(journal.entries.filter((entry) => entry.idx === 35).length, 1);
  assert.equal(tail?.idx, 35);
  assert.equal(tail?.tag, "0035_shared_paper_lifecycle");
  assert.match(lifecycleMigration, /ADD COLUMN "archived_at"/);
  assert.match(lifecycleMigration, /archive_shared_paper/);
  assert.match(lifecycleMigration, /restore_shared_paper/);
  assert.match(lifecycleMigration, /delete_shared_paper/);
});
