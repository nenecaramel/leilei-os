ALTER TABLE "tasks" ALTER COLUMN "due_time" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_timezone_not_blank" CHECK (char_length(btrim("user_settings"."timezone")) > 0);