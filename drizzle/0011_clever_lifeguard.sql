CREATE TYPE "public"."task_lifecycle_status" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "lifecycle_status" "task_lifecycle_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_user_lifecycle_due_created_idx" ON "tasks" USING btree ("user_id","lifecycle_status","due_time","created_at" DESC NULLS LAST,"id");