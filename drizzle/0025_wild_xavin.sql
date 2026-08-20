ALTER TABLE "mcp_write_idempotency" DROP CONSTRAINT "mcp_write_idempotency_tool_allowed";--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency" DROP CONSTRAINT "mcp_write_idempotency_resource_type_allowed";--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency" ALTER COLUMN "resource_id" SET DATA TYPE text USING "resource_id"::text;--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency" ADD CONSTRAINT "mcp_write_idempotency_tool_allowed" CHECK ("mcp_write_idempotency"."tool_name" IN ('create_task', 'write_diary', 'write_memory', 'toy_set', 'toy_stop', 'write_todo_paper', 'create_universe_node', 'create_universe_relation'));--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency" ADD CONSTRAINT "mcp_write_idempotency_resource_type_allowed" CHECK ("mcp_write_idempotency"."resource_type" IN ('task', 'diary_entry', 'memory', 'toy_command', 'todo_paper', 'universe_node', 'universe_relation'));
