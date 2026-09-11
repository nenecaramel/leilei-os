CREATE TABLE "shared_paper_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"base_revision" integer NOT NULL,
	"revision" integer NOT NULL,
	"author" "content_author" NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"deleted_text" text NOT NULL,
	"inserted_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_paper_edits_base_revision_positive" CHECK ("shared_paper_edits"."base_revision" >= 1),
	CONSTRAINT "shared_paper_edits_revision_step" CHECK ("shared_paper_edits"."revision" = "shared_paper_edits"."base_revision" + 1),
	CONSTRAINT "shared_paper_edits_offsets_valid" CHECK ("shared_paper_edits"."start_offset" >= 0 AND "shared_paper_edits"."end_offset" >= "shared_paper_edits"."start_offset"),
	CONSTRAINT "shared_paper_edits_deleted_length_matches" CHECK (char_length("shared_paper_edits"."deleted_text") = "shared_paper_edits"."end_offset" - "shared_paper_edits"."start_offset"),
	CONSTRAINT "shared_paper_edits_not_noop" CHECK ("shared_paper_edits"."deleted_text" <> "shared_paper_edits"."inserted_text")
);
--> statement-breakpoint
CREATE TABLE "shared_papers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" "content_author" NOT NULL,
	"updated_by" "content_author" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_papers_revision_positive" CHECK ("shared_papers"."revision" >= 1),
	CONSTRAINT "shared_papers_title_not_blank" CHECK (char_length(btrim("shared_papers"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency" DROP CONSTRAINT "mcp_write_idempotency_tool_allowed";--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency" DROP CONSTRAINT "mcp_write_idempotency_resource_type_allowed";--> statement-breakpoint
ALTER TABLE "shared_paper_edits" ADD CONSTRAINT "shared_paper_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "shared_paper_edits" ADD CONSTRAINT "shared_paper_edits_paper_user_fk" FOREIGN KEY ("paper_id","user_id") REFERENCES "public"."shared_papers"("id","user_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "shared_papers" ADD CONSTRAINT "shared_papers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "shared_paper_edits_paper_revision_uidx" ON "shared_paper_edits" USING btree ("paper_id","revision");--> statement-breakpoint
CREATE INDEX "shared_paper_edits_paper_revision_idx" ON "shared_paper_edits" USING btree ("paper_id","revision" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "shared_papers_id_user_unique_idx" ON "shared_papers" USING btree ("id","user_id");--> statement-breakpoint
CREATE INDEX "shared_papers_user_updated_id_idx" ON "shared_papers" USING btree ("user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency" ADD CONSTRAINT "mcp_write_idempotency_tool_allowed" CHECK ("mcp_write_idempotency"."tool_name" IN ('create_task', 'write_diary', 'write_memory', 'toy_set', 'toy_stop', 'write_todo_paper', 'create_universe_node', 'create_universe_relation', 'create_shared_paper', 'edit_shared_paper'));--> statement-breakpoint
ALTER TABLE "mcp_write_idempotency" ADD CONSTRAINT "mcp_write_idempotency_resource_type_allowed" CHECK ("mcp_write_idempotency"."resource_type" IN ('task', 'diary_entry', 'memory', 'toy_command', 'todo_paper', 'universe_node', 'universe_relation', 'shared_paper', 'shared_paper_edit'));