CREATE TABLE "mcp_write_idempotency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tool_name" varchar(100) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"resource_type" varchar(32) NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_write_idempotency_tool_allowed" CHECK ("mcp_write_idempotency"."tool_name" IN ('create_task', 'write_diary', 'toy_set', 'toy_stop')),
	CONSTRAINT "mcp_write_idempotency_key_format" CHECK ("mcp_write_idempotency"."idempotency_key" ~ '^[A-Za-z0-9._:-]{16,128}$'),
	CONSTRAINT "mcp_write_idempotency_hash_format" CHECK ("mcp_write_idempotency"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mcp_write_idempotency_resource_type_allowed" CHECK ("mcp_write_idempotency"."resource_type" IN ('task', 'diary_entry', 'toy_command'))
);
--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency" ADD CONSTRAINT "mcp_write_idempotency_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_write_idempotency_user_tool_key_unique_idx" ON "mcp_write_idempotency" USING btree ("user_id","tool_name","idempotency_key");--> statement-breakpoint
CREATE INDEX "mcp_write_idempotency_resource_idx" ON "mcp_write_idempotency" USING btree ("resource_type","resource_id");