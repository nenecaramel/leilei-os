CREATE TYPE "public"."memory_category" AS ENUM('profile', 'preference', 'goal', 'project');--> statement-breakpoint
CREATE TYPE "public"."memory_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."memory_visibility" AS ENUM('assistant', 'private', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "core_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "memory_category" NOT NULL,
	"key" varchar(100) NOT NULL,
	"content" text NOT NULL,
	"visibility" "memory_visibility" DEFAULT 'assistant' NOT NULL,
	"source" varchar(100) NOT NULL,
	"status" "memory_status" DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_memories_key_not_blank" CHECK (char_length(btrim("core_memories"."key")) > 0),
	CONSTRAINT "core_memories_content_not_blank" CHECK (char_length(btrim("core_memories"."content")) > 0),
	CONSTRAINT "core_memories_source_not_blank" CHECK (char_length(btrim("core_memories"."source")) > 0),
	CONSTRAINT "core_memories_sort_order_nonnegative" CHECK ("core_memories"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_not_blank" CHECK (char_length(btrim("users"."email")) > 0),
	CONSTRAINT "users_display_name_not_blank" CHECK (char_length(btrim("users"."display_name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "core_memories" ADD CONSTRAINT "core_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "core_memories_user_key_unique_idx" ON "core_memories" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "core_memories_user_category_idx" ON "core_memories" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX "core_memories_read_scope_idx" ON "core_memories" USING btree ("user_id","visibility","status","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique_idx" ON "users" USING btree ("email");