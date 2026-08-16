ALTER TABLE "toy_commands" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
UPDATE "toy_commands" SET "duration_seconds" = 60 WHERE "action" = 'set' AND "duration_seconds" IS NULL;--> statement-breakpoint
ALTER TABLE "toy_commands" ALTER COLUMN "duration_seconds" SET DEFAULT 60;--> statement-breakpoint
ALTER TABLE "toy_commands" ADD CONSTRAINT "toy_commands_duration_seconds_consistency" CHECK (("toy_commands"."action" = 'set' AND "toy_commands"."duration_seconds" BETWEEN 1 AND 1200) OR ("toy_commands"."action" = 'stop' AND ("toy_commands"."duration_seconds" IS NULL OR "toy_commands"."duration_seconds" = 60)));
