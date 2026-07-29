CREATE TYPE "public"."diary_status" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "status" "diary_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE INDEX "diary_entries_user_status_date_created_idx" ON "diary_entries" USING btree ("user_id","status","date" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "diary_entries_user_status_updated_id_idx" ON "diary_entries" USING btree ("user_id","status","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);