ALTER TABLE mcp_write_idempotency DROP CONSTRAINT mcp_write_idempotency_tool_allowed;
--> statement-breakpoint
ALTER TABLE mcp_write_idempotency ADD CONSTRAINT mcp_write_idempotency_tool_allowed CHECK (tool_name IN ('write_memory', 'write_diary', 'toy_set', 'toy_stop', 'write_todo_paper', 'append_todo_entry', 'update_todo_entry', 'delete_todo_entry', 'create_universe_node', 'create_universe_relation', 'add_diary_comment'));
--> statement-breakpoint
ALTER TABLE mcp_write_idempotency DROP CONSTRAINT mcp_write_idempotency_resource_type_allowed;
--> statement-breakpoint
ALTER TABLE mcp_write_idempotency ADD CONSTRAINT mcp_write_idempotency_resource_type_allowed CHECK (resource_type IN ('mind_state', 'diary_entry', 'toy_command', 'todo_paper', 'todo_entry', 'universe_node', 'universe_relation', 'diary_comment'));
