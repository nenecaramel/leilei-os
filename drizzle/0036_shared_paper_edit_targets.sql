ALTER TABLE "shared_paper_edits" ADD COLUMN "target" varchar(16) DEFAULT 'content' NOT NULL;--> statement-breakpoint
ALTER TABLE "shared_paper_edits" ADD CONSTRAINT "shared_paper_edits_target_allowed" CHECK ("shared_paper_edits"."target" IN ('content', 'title'));
