import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readSchemaSource } from "./helpers/schema-source.js";

const migration = readFileSync(
  "drizzle/0061_retire_memory_task_shared_paper.sql",
  "utf8",
);
const schema = readSchemaSource();

test("retired module purge drops only legacy Memory Task and Shared Paper storage", () => {
  for (const table of [
    "core_memories",
    "tasks",
    "shared_papers",
    "shared_paper_edits",
  ]) {
    assert.match(
      migration,
      new RegExp('DROP TABLE IF EXISTS "' + table + '"'),
    );
    assert.equal(
      schema.includes('pgTable(\n  "' + table + '"'),
      false,
    );
  }

  for (const type of [
    "memory_category",
    "memory_visibility",
    "memory_status",
    "task_status",
    "task_lifecycle_status",
    "task_priority",
  ]) {
    assert.match(
      migration,
      new RegExp('DROP TYPE IF EXISTS "' + type + '"'),
    );
  }
});

test("retired module purge keeps Runtime Mind and active content storage untouched", () => {
  for (const protectedName of [
    "runtime_subject_state",
    "runtime_thoughts",
    "runtime_drives",
    "runtime_topics",
    "diary_entries",
    "todo_papers",
    "todo_entries",
    "universe_nodes",
    "conversations",
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp('DROP TABLE IF EXISTS "' + protectedName + '"'),
    );
  }

  assert.match(schema, /runtime_subject_state/);
  assert.match(schema, /diary_entries/);
  assert.match(schema, /todo_papers/);
  assert.match(schema, /universe_nodes/);
  assert.match(schema, /conversations/);
});

test("retired product activity and stale metadata are purged with the data", () => {
  assert.match(
    migration,
    /resource_lifecycle_events[\s\S]*resource_type[\s\S]*memory[\s\S]*task[\s\S]*shared_paper/,
  );
  assert.match(
    migration,
    /tool_calls[\s\S]*resource_type[\s\S]*memory[\s\S]*task[\s\S]*shared_paper/,
  );
  assert.match(
    migration,
    /mcp_write_idempotency[\s\S]*resource_type[\s\S]*memory[\s\S]*task[\s\S]*shared_paper[\s\S]*shared_paper_edit/,
  );
  assert.match(
    migration,
    /data_import_runs[\s\S]*summary[\s\S]*memory[\s\S]*task[\s\S]*shared_paper/,
  );
  assert.match(
    migration,
    /page_copy[\s\S]*memorySubtitle[\s\S]*taskSubtitle/,
  );
});

test("retired module names are removed from legacy idempotency and lifecycle constraints", () => {
  const idempotencyStart =
    schema.indexOf("export const mcpWriteIdempotency");
  const lifecycleStart =
    schema.indexOf("export const resourceLifecycleEvents");
  assert.ok(idempotencyStart >= 0);
  assert.ok(lifecycleStart > idempotencyStart);

  const idempotencySchema = schema.slice(
    idempotencyStart,
    lifecycleStart,
  );

  for (const retired of [
    "create_task",
    "write_memory",
    "create_shared_paper",
    "edit_shared_paper",
    "append_shared_paper",
    "archive_shared_paper",
    "restore_shared_paper",
    "delete_shared_paper",
    '"task"',
    '"memory"',
    '"shared_paper"',
    '"shared_paper_edit"',
  ]) {
    assert.equal(
      idempotencySchema.includes(retired),
      false,
      "retired idempotency token remains: " + retired,
    );
  }

  const lifecycleEnd =
    schema.indexOf("export const dataImportRuns");
  assert.ok(lifecycleEnd > lifecycleStart);
  const lifecycleSchema = schema.slice(
    lifecycleStart,
    lifecycleEnd,
  );

  assert.match(
    lifecycleSchema,
    /\.\$type<"diary">\(\)/,
  );
  assert.equal(
    lifecycleSchema.includes('"memory"'),
    false,
  );
  assert.equal(
    lifecycleSchema.includes('"task"'),
    false,
  );
});


test("retired module names are removed from shared lifecycle and idempotency domain types", () => {
  const lifecycleRepository = readFileSync(
    "src/domains/lifecycle/lifecycle-audit-repository.ts",
    "utf8",
  );
  const idempotencyRepository = readFileSync(
    "src/domains/mcp-write/mcp-write-idempotency.ts",
    "utf8",
  );

  assert.match(
    lifecycleRepository,
    /export type LifecycleResourceType = "diary";/,
  );
  for (const retired of ['"memory"', '"task"']) {
    assert.equal(
      lifecycleRepository.includes(
        `LifecycleResourceType = ${retired}`,
      ),
      false,
    );
  }

  for (const retired of [
    '"create_task"',
    '"write_memory"',
    '"create_shared_paper"',
    '"edit_shared_paper"',
    '"append_shared_paper"',
    '"archive_shared_paper"',
    '"restore_shared_paper"',
    '"delete_shared_paper"',
    '"memory"',
    '"task"',
    '"shared_paper"',
    '"shared_paper_edit"',
  ]) {
    assert.equal(
      idempotencyRepository.includes(retired),
      false,
      "retired idempotency domain type remains: " + retired,
    );
  }
});
