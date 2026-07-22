CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"due_time" timestamp with time zone NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"tags" varchar(50)[] DEFAULT ARRAY[]::varchar(50)[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tasks_title_not_blank" CHECK (char_length(btrim("tasks"."title")) > 0),
	CONSTRAINT "tasks_description_not_blank" CHECK (char_length(btrim("tasks"."description")) > 0),
	CONSTRAINT "tasks_timezone_not_blank" CHECK (char_length(btrim("tasks"."timezone")) > 0),
	CONSTRAINT "tasks_timezone_format" CHECK ("tasks"."timezone" ~ '^[A-Za-z0-9_+.-]+(/[A-Za-z0-9_+.-]+)*$'),
	CONSTRAINT "tasks_tags_limit" CHECK (cardinality("tasks"."tags") <= 20),
	CONSTRAINT "tasks_completed_at_consistency" CHECK (("tasks"."status" = 'completed' AND "tasks"."completed_at" IS NOT NULL) OR ("tasks"."status" <> 'completed' AND "tasks"."completed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "tasks_user_status_due_idx" ON "tasks" USING btree ("user_id","status","due_time");--> statement-breakpoint
CREATE INDEX "tasks_user_due_idx" ON "tasks" USING btree ("user_id","due_time");--> statement-breakpoint
CREATE INDEX "tasks_user_created_idx" ON "tasks" USING btree ("user_id","created_at" DESC NULLS LAST);