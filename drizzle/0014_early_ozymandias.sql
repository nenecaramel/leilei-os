ALTER TABLE "tasks" ADD COLUMN "resume_status" "task_status";--> statement-breakpoint
UPDATE "tasks" SET "resume_status" = 'in_progress' WHERE "status" = 'completed';--> statement-breakpoint
UPDATE "tasks" SET "resume_status" = 'pending' WHERE "status" = 'cancelled';--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_resume_status_consistency" CHECK ((("tasks"."status" IN ('pending', 'in_progress') AND "tasks"."resume_status" IS NULL) OR ("tasks"."status" IN ('completed', 'cancelled') AND "tasks"."resume_status" IS NOT NULL AND "tasks"."resume_status" IN ('pending', 'in_progress'))));
