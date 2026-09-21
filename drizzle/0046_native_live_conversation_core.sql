ALTER TABLE "conversations" ADD COLUMN "origin" varchar(32) DEFAULT 'legacy_import' NOT NULL;
ALTER TABLE "conversations" ADD COLUMN "lifecycle_status" varchar(32) DEFAULT 'active' NOT NULL;
ALTER TABLE "conversations" ADD COLUMN "current_head_message_id" uuid;
UPDATE "conversations"
SET "lifecycle_status" = CASE
  WHEN "deleted_at" IS NOT NULL THEN 'deleted'
  WHEN "archived_at" IS NOT NULL THEN 'archived'
  ELSE 'active'
END;
ALTER TABLE "conversations" ALTER COLUMN "provider" DROP NOT NULL;
ALTER TABLE "conversations" ALTER COLUMN "source_conversation_id" DROP NOT NULL;
ALTER TABLE "conversations" ALTER COLUMN "source_fingerprint" DROP NOT NULL;
ALTER TABLE "conversations" ALTER COLUMN "first_seen_import_id" DROP NOT NULL;
ALTER TABLE "conversations" ALTER COLUMN "last_seen_import_id" DROP NOT NULL;
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_provider_allowed";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_provider_allowed" CHECK ("conversations"."provider" IS NULL OR "conversations"."provider" IN ('chatgpt', 'claude'));
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_origin_allowed" CHECK ("conversations"."origin" IN ('legacy_import', 'native_live'));
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lifecycle_status_allowed" CHECK ("conversations"."lifecycle_status" IN ('active', 'archived', 'deleted'));
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_origin_provenance_consistency" CHECK (
  ("conversations"."origin" = 'legacy_import'
    AND "conversations"."provider" IS NOT NULL
    AND "conversations"."source_conversation_id" IS NOT NULL
    AND "conversations"."source_fingerprint" IS NOT NULL
    AND "conversations"."first_seen_import_id" IS NOT NULL
    AND "conversations"."last_seen_import_id" IS NOT NULL)
  OR
  ("conversations"."origin" = 'native_live'
    AND "conversations"."provider" IS NULL
    AND "conversations"."source_conversation_id" IS NULL
    AND "conversations"."source_fingerprint" IS NULL
    AND "conversations"."first_seen_import_id" IS NULL
    AND "conversations"."last_seen_import_id" IS NULL)
);
CREATE INDEX "conversations_user_origin_updated_idx" ON "conversations" USING btree ("user_id","origin","updated_at" DESC,"id" DESC);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "parent_message_id" uuid;
ALTER TABLE "conversation_messages" ADD COLUMN "status" varchar(32) DEFAULT 'completed' NOT NULL;
ALTER TABLE "conversation_messages" ADD COLUMN "completed_at" timestamp with time zone;
ALTER TABLE "conversation_messages" ALTER COLUMN "source_node_id" DROP NOT NULL;
ALTER TABLE "conversation_messages" ALTER COLUMN "source_fingerprint" DROP NOT NULL;
ALTER TABLE "conversation_messages" ALTER COLUMN "first_seen_import_id" DROP NOT NULL;
ALTER TABLE "conversation_messages" ALTER COLUMN "last_seen_import_id" DROP NOT NULL;
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_status_allowed" CHECK ("conversation_messages"."status" IN ('pending', 'streaming', 'completed', 'error'));
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_provenance_consistency" CHECK (
  ("conversation_messages"."source_node_id" IS NULL
    AND "conversation_messages"."parent_source_node_id" IS NULL
    AND "conversation_messages"."source_fingerprint" IS NULL
    AND "conversation_messages"."first_seen_import_id" IS NULL
    AND "conversation_messages"."last_seen_import_id" IS NULL)
  OR
  ("conversation_messages"."source_node_id" IS NOT NULL
    AND "conversation_messages"."source_fingerprint" IS NOT NULL
    AND "conversation_messages"."first_seen_import_id" IS NOT NULL
    AND "conversation_messages"."last_seen_import_id" IS NOT NULL)
);
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_id_conversation_user_unique" UNIQUE("id","conversation_id","user_id");
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_parent_same_conversation_fk" FOREIGN KEY ("parent_message_id","conversation_id","user_id") REFERENCES "public"."conversation_messages"("id","conversation_id","user_id") ON DELETE cascade ON UPDATE cascade;
CREATE INDEX "conversation_messages_conversation_parent_idx" ON "conversation_messages" USING btree ("conversation_id","parent_message_id","created_at","id");
--> statement-breakpoint
ALTER TABLE "conversation_content_blocks" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "conversation_content_blocks" DROP CONSTRAINT "conversation_content_blocks_kind_allowed";
ALTER TABLE "conversation_content_blocks" ADD CONSTRAINT "conversation_content_blocks_kind_allowed" CHECK ("conversation_content_blocks"."kind" IN ('text', 'thinking', 'reasoning_recap', 'tool_use', 'tool_result', 'image', 'audio', 'video', 'file', 'attachment', 'unknown'));
--> statement-breakpoint
CREATE TABLE "conversation_provider_session_checkpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "canonical_message_id" uuid NOT NULL,
  "provider" varchar(32) NOT NULL,
  "provider_session_id" text NOT NULL,
  "provider_checkpoint_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_provider_session_checkpoints_provider_allowed" CHECK ("conversation_provider_session_checkpoints"."provider" = 'claude_code'),
  CONSTRAINT "conversation_provider_session_checkpoints_session_not_blank" CHECK (char_length(btrim("conversation_provider_session_checkpoints"."provider_session_id")) > 0),
  CONSTRAINT "conversation_provider_session_checkpoints_checkpoint_not_blank" CHECK ("conversation_provider_session_checkpoints"."provider_checkpoint_id" IS NULL OR char_length(btrim("conversation_provider_session_checkpoints"."provider_checkpoint_id")) > 0)
);
ALTER TABLE "conversation_provider_session_checkpoints" ADD CONSTRAINT "conversation_provider_session_checkpoints_conversation_user_fk" FOREIGN KEY ("conversation_id","user_id") REFERENCES "public"."conversations"("id","user_id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "conversation_provider_session_checkpoints" ADD CONSTRAINT "conversation_provider_session_checkpoints_message_conversation_user_fk" FOREIGN KEY ("canonical_message_id","conversation_id","user_id") REFERENCES "public"."conversation_messages"("id","conversation_id","user_id") ON DELETE cascade ON UPDATE cascade;
CREATE UNIQUE INDEX "conversation_provider_session_checkpoints_message_provider_uidx" ON "conversation_provider_session_checkpoints" USING btree ("conversation_id","canonical_message_id","provider");
CREATE INDEX "conversation_provider_session_checkpoints_user_head_idx" ON "conversation_provider_session_checkpoints" USING btree ("user_id","conversation_id","canonical_message_id");
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_current_head_same_conversation_fk" FOREIGN KEY ("current_head_message_id","id","user_id") REFERENCES "public"."conversation_messages"("id","conversation_id","user_id") ON DELETE SET NULL ("current_head_message_id") ON UPDATE cascade;
