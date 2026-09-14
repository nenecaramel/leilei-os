CREATE TABLE "diary_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"diary_id" uuid NOT NULL,
	"author" "content_author" NOT NULL,
	"content" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diary_comments_content_not_blank" CHECK (char_length(btrim("diary_comments"."content")) > 0),
	CONSTRAINT "diary_comments_content_limit" CHECK (char_length("diary_comments"."content") <= 10000),
	CONSTRAINT "diary_comments_revision_positive" CHECK ("diary_comments"."revision" >= 1),
	CONSTRAINT "diary_comments_idempotency_key_format" CHECK ("diary_comments"."idempotency_key" ~ '^[A-Za-z0-9._:-]{16,128}$'),
	CONSTRAINT "diary_comments_request_hash_format" CHECK ("diary_comments"."request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "diary_comments" ADD CONSTRAINT "diary_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "diary_comments" ADD CONSTRAINT "diary_comments_user_diary_fk" FOREIGN KEY ("user_id","diary_id") REFERENCES "public"."diary_entries"("user_id","id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "diary_comments_user_idempotency_unique_idx" ON "diary_comments" USING btree ("user_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "diary_comments_user_id_id_uidx" ON "diary_comments" USING btree ("user_id","id");
--> statement-breakpoint
CREATE INDEX "diary_comments_user_diary_created_id_idx" ON "diary_comments" USING btree ("user_id","diary_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
