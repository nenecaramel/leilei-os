ALTER TABLE "conversations" ADD COLUMN "archived_at" timestamp with time zone;
ALTER TABLE "conversations" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lifecycle_exclusive" CHECK (NOT ("conversations"."archived_at" IS NOT NULL AND "conversations"."deleted_at" IS NOT NULL));
CREATE INDEX "conversations_user_archived_idx" ON "conversations" USING btree ("user_id","archived_at" DESC,"id" DESC) WHERE "conversations"."archived_at" IS NOT NULL;
CREATE INDEX "conversations_user_deleted_idx" ON "conversations" USING btree ("user_id","deleted_at" DESC,"id" DESC) WHERE "conversations"."deleted_at" IS NOT NULL;
CREATE TABLE "conversation_deleted_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"source_conversation_id" text NOT NULL,
	"source_node_id" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_deleted_branches_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "conversation_deleted_branches_provider_allowed" CHECK ("conversation_deleted_branches"."provider" IN ('chatgpt', 'claude')),
	CONSTRAINT "conversation_deleted_branches_source_conversation_not_blank" CHECK (char_length(btrim("conversation_deleted_branches"."source_conversation_id")) > 0),
	CONSTRAINT "conversation_deleted_branches_source_node_not_blank" CHECK (char_length(btrim("conversation_deleted_branches"."source_node_id")) > 0)
);
ALTER TABLE "conversation_deleted_branches" ADD CONSTRAINT "conversation_deleted_branches_conversation_user_fk" FOREIGN KEY ("conversation_id","user_id") REFERENCES "public"."conversations"("id","user_id") ON DELETE cascade ON UPDATE cascade;
CREATE UNIQUE INDEX "conversation_deleted_branches_unit_uidx" ON "conversation_deleted_branches" USING btree ("user_id","conversation_id","source_node_id");
CREATE INDEX "conversation_deleted_branches_user_deleted_idx" ON "conversation_deleted_branches" USING btree ("user_id","deleted_at" DESC,"id" DESC);
