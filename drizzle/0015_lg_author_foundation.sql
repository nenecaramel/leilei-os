CREATE TYPE "public"."content_author" AS ENUM('L', 'G');--> statement-breakpoint
ALTER TABLE "core_memories" ADD COLUMN "author" "content_author";--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "author" "content_author";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "author" "content_author";