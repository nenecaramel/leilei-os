ALTER TABLE "shared_papers" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "shared_papers_user_archive_updated_id_idx" ON "shared_papers" USING btree ("user_id","archived_at","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency" DROP CONSTRAINT "mcp_write_idempotency_tool_allowed";--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency" ADD CONSTRAINT "mcp_write_idempotency_tool_allowed" CHECK ("mcp_write_idempotency"."tool_name" IN ('create_task', 'write_diary', 'write_memory', 'toy_set', 'toy_stop', 'write_todo_paper', 'create_universe_node', 'create_universe_relation', 'create_shared_paper', 'edit_shared_paper', 'archive_shared_paper', 'restore_shared_paper', 'delete_shared_paper'));
