CREATE TYPE "public"."todo_entry_kind" AS ENUM('pending', 'completed', 'record');--> statement-breakpoint
CREATE TABLE "todo_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" uuid NOT NULL,
	"entry_id" text NOT NULL,
	"kind" "todo_entry_kind" NOT NULL,
	"text" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "todo_entries_entry_id_nonblank" CHECK (char_length(btrim("todo_entries"."entry_id")) > 0),
	CONSTRAINT "todo_entries_text_nonblank" CHECK (char_length(btrim("todo_entries"."text")) > 0),
	CONSTRAINT "todo_entries_position_nonnegative" CHECK ("todo_entries"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "todo_papers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"author" "content_author" NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todo_papers_revision_nonnegative" CHECK ("todo_papers"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "todo_entries" ADD CONSTRAINT "todo_entries_paper_id_todo_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."todo_papers"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "todo_papers" ADD CONSTRAINT "todo_papers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "todo_entries_paper_entry_uidx" ON "todo_entries" USING btree ("paper_id","entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "todo_entries_paper_position_uidx" ON "todo_entries" USING btree ("paper_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "todo_papers_user_date_author_uidx" ON "todo_papers" USING btree ("user_id","business_date","author");