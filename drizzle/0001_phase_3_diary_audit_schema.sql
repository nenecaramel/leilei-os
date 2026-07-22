CREATE TYPE "public"."diary_source" AS ENUM('chatgpt_mcp');--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('success', 'rejected', 'error');--> statement-breakpoint
CREATE TABLE "diary_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"date" date NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"mood" varchar(50),
	"source" "diary_source" DEFAULT 'chatgpt_mcp' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diary_entries_title_not_blank" CHECK (char_length(btrim("diary_entries"."title")) > 0),
	CONSTRAINT "diary_entries_content_not_blank" CHECK (char_length(btrim("diary_entries"."content")) > 0),
	CONSTRAINT "diary_entries_mood_not_blank" CHECK ("diary_entries"."mood" IS NULL OR char_length(btrim("diary_entries"."mood")) > 0),
	CONSTRAINT "diary_entries_idempotency_key_not_blank" CHECK (char_length(btrim("diary_entries"."idempotency_key")) > 0),
	CONSTRAINT "diary_entries_request_hash_format" CHECK ("diary_entries"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "diary_entries_tags_limit" CHECK (cardinality("diary_entries"."tags") <= 20)
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tool_name" varchar(100) NOT NULL,
	"operation" varchar(50) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" uuid,
	"idempotency_key" varchar(128),
	"request_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"status" "tool_call_status" NOT NULL,
	"error_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_calls_tool_name_not_blank" CHECK (char_length(btrim("tool_calls"."tool_name")) > 0),
	CONSTRAINT "tool_calls_operation_not_blank" CHECK (char_length(btrim("tool_calls"."operation")) > 0),
	CONSTRAINT "tool_calls_resource_type_not_blank" CHECK (char_length(btrim("tool_calls"."resource_type")) > 0),
	CONSTRAINT "tool_calls_idempotency_key_not_blank" CHECK ("tool_calls"."idempotency_key" IS NULL OR char_length(btrim("tool_calls"."idempotency_key")) > 0),
	CONSTRAINT "tool_calls_duration_nonnegative" CHECK ("tool_calls"."duration_ms" >= 0),
	CONSTRAINT "tool_calls_success_has_no_error" CHECK ("tool_calls"."status" <> 'success' OR "tool_calls"."error_code" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_resource_id_diary_entries_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."diary_entries"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "diary_entries_user_idempotency_unique_idx" ON "diary_entries" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "diary_entries_user_date_created_idx" ON "diary_entries" USING btree ("user_id","date" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "diary_entries_user_created_idx" ON "diary_entries" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tool_calls_user_created_idx" ON "tool_calls" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tool_calls_tool_status_created_idx" ON "tool_calls" USING btree ("tool_name","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tool_calls_resource_idx" ON "tool_calls" USING btree ("resource_type","resource_id");