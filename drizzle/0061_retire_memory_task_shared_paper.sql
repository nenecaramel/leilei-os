DELETE FROM "resource_lifecycle_events"
WHERE "resource_type" IN ('memory', 'task', 'shared_paper');
--> statement-breakpoint
DELETE FROM "tool_calls"
WHERE "resource_type" IN ('memory', 'task', 'shared_paper', 'shared_paper_edit')
   OR "tool_name" IN (
     'create_task',
     'write_memory',
     'create_shared_paper',
     'edit_shared_paper',
     'append_shared_paper',
     'archive_shared_paper',
     'restore_shared_paper',
     'delete_shared_paper'
   );
--> statement-breakpoint
DELETE FROM "mcp_write_idempotency"
WHERE "resource_type" IN ('memory', 'task', 'shared_paper', 'shared_paper_edit')
   OR "tool_name" IN (
     'create_task',
     'write_memory',
     'create_shared_paper',
     'edit_shared_paper',
     'append_shared_paper',
     'archive_shared_paper',
     'restore_shared_paper',
     'delete_shared_paper'
   );
--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency"
  DROP CONSTRAINT "mcp_write_idempotency_tool_allowed";
--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency"
  ADD CONSTRAINT "mcp_write_idempotency_tool_allowed"
  CHECK (
    "tool_name" IN (
      'write_diary',
      'toy_set',
      'toy_stop',
      'write_todo_paper',
      'append_todo_entry',
      'update_todo_entry',
      'delete_todo_entry',
      'create_universe_node',
      'create_universe_relation',
      'add_diary_comment'
    )
  );
--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency"
  DROP CONSTRAINT "mcp_write_idempotency_resource_type_allowed";
--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency"
  ADD CONSTRAINT "mcp_write_idempotency_resource_type_allowed"
  CHECK (
    "resource_type" IN (
      'diary_entry',
      'toy_command',
      'todo_paper',
      'todo_entry',
      'universe_node',
      'universe_relation',
      'diary_comment'
    )
  );
--> statement-breakpoint
ALTER TABLE "resource_lifecycle_events"
  DROP CONSTRAINT "resource_lifecycle_events_resource_type_allowed";
--> statement-breakpoint
ALTER TABLE "resource_lifecycle_events"
  ADD CONSTRAINT "resource_lifecycle_events_resource_type_allowed"
  CHECK ("resource_type" IN ('diary'));
--> statement-breakpoint
UPDATE "data_import_runs"
SET "summary" = COALESCE("summary", '{}'::jsonb)
  - 'memory'
  - 'task'
  - 'shared_paper'
WHERE "summary" ? 'memory'
   OR "summary" ? 'task'
   OR "summary" ? 'shared_paper';
--> statement-breakpoint
UPDATE "user_settings"
SET "page_copy" = COALESCE("page_copy", '{}'::jsonb)
  - 'memorySubtitle'
  - 'taskSubtitle'
WHERE "page_copy" ? 'memorySubtitle'
   OR "page_copy" ? 'taskSubtitle';
--> statement-breakpoint
DROP TABLE IF EXISTS "shared_paper_edits";
--> statement-breakpoint
DROP TABLE IF EXISTS "shared_papers";
--> statement-breakpoint
DROP TABLE IF EXISTS "tasks";
--> statement-breakpoint
DROP TABLE IF EXISTS "core_memories";
--> statement-breakpoint
DROP TYPE IF EXISTS "task_priority";
--> statement-breakpoint
DROP TYPE IF EXISTS "task_lifecycle_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "task_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "memory_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "memory_visibility";
--> statement-breakpoint
DROP TYPE IF EXISTS "memory_category";
