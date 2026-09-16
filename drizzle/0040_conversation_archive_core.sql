CREATE TABLE "conversation_import_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" varchar(32) NOT NULL,
  "original_filename" text NOT NULL,
  "raw_sha256" varchar(64) NOT NULL,
  "raw_bytes" bigint NOT NULL,
  "storage_kind" varchar(32),
  "storage_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_import_sources_id_user_unique" UNIQUE("id","user_id"),
  CONSTRAINT "conversation_import_sources_provider_allowed" CHECK ("conversation_import_sources"."provider" IN ('chatgpt', 'claude')),
  CONSTRAINT "conversation_import_sources_filename_not_blank" CHECK (char_length(btrim("conversation_import_sources"."original_filename")) > 0),
  CONSTRAINT "conversation_import_sources_sha_format" CHECK ("conversation_import_sources"."raw_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "conversation_import_sources_raw_bytes_nonnegative" CHECK ("conversation_import_sources"."raw_bytes" >= 0),
  CONSTRAINT "conversation_import_sources_storage_pair" CHECK (("conversation_import_sources"."storage_kind" IS NULL AND "conversation_import_sources"."storage_key" IS NULL) OR ("conversation_import_sources"."storage_kind" IS NOT NULL AND "conversation_import_sources"."storage_key" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "conversation_import_sources" ADD CONSTRAINT "conversation_import_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_import_sources_user_sha_uidx" ON "conversation_import_sources" USING btree ("user_id","raw_sha256");
--> statement-breakpoint
CREATE INDEX "conversation_import_sources_user_created_idx" ON "conversation_import_sources" USING btree ("user_id","created_at" DESC,"id" DESC);
--> statement-breakpoint

CREATE TABLE "conversation_import_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "parser_version" varchar(64) NOT NULL,
  "status" varchar(32) DEFAULT 'processing' NOT NULL,
  "preview_fingerprint" varchar(64),
  "summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "warning_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "conversation_import_runs_id_user_unique" UNIQUE("id","user_id"),
  CONSTRAINT "conversation_import_runs_parser_not_blank" CHECK (char_length(btrim("conversation_import_runs"."parser_version")) > 0),
  CONSTRAINT "conversation_import_runs_status_allowed" CHECK ("conversation_import_runs"."status" IN ('processing', 'executed', 'failed')),
  CONSTRAINT "conversation_import_runs_preview_format" CHECK ("conversation_import_runs"."preview_fingerprint" IS NULL OR "conversation_import_runs"."preview_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "conversation_import_runs_summary_object" CHECK (jsonb_typeof("conversation_import_runs"."summary") = 'object'),
  CONSTRAINT "conversation_import_runs_warning_count_nonnegative" CHECK ("conversation_import_runs"."warning_count" >= 0),
  CONSTRAINT "conversation_import_runs_completion_consistency" CHECK (("conversation_import_runs"."status" = 'processing' AND "conversation_import_runs"."completed_at" IS NULL) OR ("conversation_import_runs"."status" IN ('executed', 'failed') AND "conversation_import_runs"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "conversation_import_runs" ADD CONSTRAINT "conversation_import_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "conversation_import_runs" ADD CONSTRAINT "conversation_import_runs_source_user_fk" FOREIGN KEY ("source_id","user_id") REFERENCES "public"."conversation_import_sources"("id","user_id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_import_runs_source_parser_executed_uidx" ON "conversation_import_runs" USING btree ("source_id","parser_version") WHERE "conversation_import_runs"."status" = 'executed';
--> statement-breakpoint
CREATE INDEX "conversation_import_runs_user_created_idx" ON "conversation_import_runs" USING btree ("user_id","created_at" DESC,"id" DESC);
--> statement-breakpoint

CREATE TABLE "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" varchar(32) NOT NULL,
  "source_conversation_id" text NOT NULL,
  "title" text,
  "source_created_at" timestamp with time zone,
  "source_updated_at" timestamp with time zone,
  "current_leaf_source_node_id" text,
  "default_model" text,
  "provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_fingerprint" varchar(64) NOT NULL,
  "first_seen_import_id" uuid NOT NULL,
  "last_seen_import_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversations_id_user_unique" UNIQUE("id","user_id"),
  CONSTRAINT "conversations_provider_allowed" CHECK ("conversations"."provider" IN ('chatgpt', 'claude')),
  CONSTRAINT "conversations_source_id_not_blank" CHECK (char_length(btrim("conversations"."source_conversation_id")) > 0),
  CONSTRAINT "conversations_fingerprint_format" CHECK ("conversations"."source_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "conversations_provider_metadata_object" CHECK (jsonb_typeof("conversations"."provider_metadata") = 'object')
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_first_import_user_fk" FOREIGN KEY ("first_seen_import_id","user_id") REFERENCES "public"."conversation_import_runs"("id","user_id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_last_import_user_fk" FOREIGN KEY ("last_seen_import_id","user_id") REFERENCES "public"."conversation_import_runs"("id","user_id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_user_provider_source_uidx" ON "conversations" USING btree ("user_id","provider","source_conversation_id");
--> statement-breakpoint
CREATE INDEX "conversations_user_provider_updated_idx" ON "conversations" USING btree ("user_id","provider","source_updated_at" DESC,"id" DESC);
--> statement-breakpoint

CREATE TABLE "conversation_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "source_node_id" text NOT NULL,
  "source_message_id" text,
  "parent_source_node_id" text,
  "role" varchar(32) NOT NULL,
  "raw_role" text,
  "model" text,
  "source_created_at" timestamp with time zone,
  "source_updated_at" timestamp with time zone,
  "is_current_path" boolean DEFAULT false NOT NULL,
  "current_path_index" integer,
  "turn_index" integer,
  "is_primary" boolean DEFAULT false NOT NULL,
  "display_text" text DEFAULT '' NOT NULL,
  "source_fingerprint" varchar(64) NOT NULL,
  "first_seen_import_id" uuid NOT NULL,
  "last_seen_import_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_messages_id_user_unique" UNIQUE("id","user_id"),
  CONSTRAINT "conversation_messages_source_node_not_blank" CHECK (char_length(btrim("conversation_messages"."source_node_id")) > 0),
  CONSTRAINT "conversation_messages_role_allowed" CHECK ("conversation_messages"."role" IN ('user', 'assistant', 'system', 'tool', 'reasoning', 'unknown')),
  CONSTRAINT "conversation_messages_fingerprint_format" CHECK ("conversation_messages"."source_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "conversation_messages_path_consistency" CHECK (("conversation_messages"."is_current_path" = true AND "conversation_messages"."current_path_index" IS NOT NULL AND "conversation_messages"."current_path_index" >= 0) OR ("conversation_messages"."is_current_path" = false AND "conversation_messages"."current_path_index" IS NULL)),
  CONSTRAINT "conversation_messages_turn_nonnegative" CHECK ("conversation_messages"."turn_index" IS NULL OR "conversation_messages"."turn_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_user_fk" FOREIGN KEY ("conversation_id","user_id") REFERENCES "public"."conversations"("id","user_id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_first_import_user_fk" FOREIGN KEY ("first_seen_import_id","user_id") REFERENCES "public"."conversation_import_runs"("id","user_id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_last_import_user_fk" FOREIGN KEY ("last_seen_import_id","user_id") REFERENCES "public"."conversation_import_runs"("id","user_id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_conversation_node_uidx" ON "conversation_messages" USING btree ("conversation_id","source_node_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_conversation_source_message_uidx" ON "conversation_messages" USING btree ("conversation_id","source_message_id") WHERE "conversation_messages"."source_message_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_current_path_index_uidx" ON "conversation_messages" USING btree ("conversation_id","current_path_index") WHERE "conversation_messages"."is_current_path" = true AND "conversation_messages"."current_path_index" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "conversation_messages_user_source_created_idx" ON "conversation_messages" USING btree ("user_id","source_created_at","id");
--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_path_idx" ON "conversation_messages" USING btree ("conversation_id","is_current_path","current_path_index");
--> statement-breakpoint

CREATE TABLE "conversation_content_blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "message_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "kind" varchar(32) NOT NULL,
  "raw_type" text NOT NULL,
  "text" text,
  "payload" jsonb,
  CONSTRAINT "conversation_content_blocks_ordinal_nonnegative" CHECK ("conversation_content_blocks"."ordinal" >= 0),
  CONSTRAINT "conversation_content_blocks_kind_allowed" CHECK ("conversation_content_blocks"."kind" IN ('text', 'thinking', 'reasoning_recap', 'tool_use', 'tool_result', 'image', 'audio', 'video', 'file', 'unknown')),
  CONSTRAINT "conversation_content_blocks_raw_type_not_blank" CHECK (char_length(btrim("conversation_content_blocks"."raw_type")) > 0),
  CONSTRAINT "conversation_content_blocks_payload_object" CHECK ("conversation_content_blocks"."payload" IS NULL OR jsonb_typeof("conversation_content_blocks"."payload") = 'object')
);
--> statement-breakpoint
ALTER TABLE "conversation_content_blocks" ADD CONSTRAINT "conversation_content_blocks_message_user_fk" FOREIGN KEY ("message_id","user_id") REFERENCES "public"."conversation_messages"("id","user_id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_content_blocks_message_ordinal_uidx" ON "conversation_content_blocks" USING btree ("message_id","ordinal");
--> statement-breakpoint
CREATE INDEX "conversation_content_blocks_user_kind_idx" ON "conversation_content_blocks" USING btree ("user_id","kind");
--> statement-breakpoint

CREATE TABLE "conversation_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "message_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "source_attachment_id" text,
  "name" text,
  "mime_type" text,
  "size_bytes" bigint,
  "payload" jsonb NOT NULL,
  CONSTRAINT "conversation_attachments_ordinal_nonnegative" CHECK ("conversation_attachments"."ordinal" >= 0),
  CONSTRAINT "conversation_attachments_size_nonnegative" CHECK ("conversation_attachments"."size_bytes" IS NULL OR "conversation_attachments"."size_bytes" >= 0),
  CONSTRAINT "conversation_attachments_payload_object" CHECK (jsonb_typeof("conversation_attachments"."payload") = 'object')
);
--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_message_user_fk" FOREIGN KEY ("message_id","user_id") REFERENCES "public"."conversation_messages"("id","user_id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_attachments_message_ordinal_uidx" ON "conversation_attachments" USING btree ("message_id","ordinal");
--> statement-breakpoint
CREATE INDEX "conversation_attachments_user_source_idx" ON "conversation_attachments" USING btree ("user_id","source_attachment_id");
--> statement-breakpoint

CREATE TABLE "conversation_message_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "message_id" uuid NOT NULL,
  "previous_fingerprint" varchar(64) NOT NULL,
  "snapshot" jsonb NOT NULL,
  "replaced_by_import_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_message_versions_fingerprint_format" CHECK ("conversation_message_versions"."previous_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "conversation_message_versions_snapshot_object" CHECK (jsonb_typeof("conversation_message_versions"."snapshot") = 'object')
);
--> statement-breakpoint
ALTER TABLE "conversation_message_versions" ADD CONSTRAINT "conversation_message_versions_message_user_fk" FOREIGN KEY ("message_id","user_id") REFERENCES "public"."conversation_messages"("id","user_id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "conversation_message_versions" ADD CONSTRAINT "conversation_message_versions_import_user_fk" FOREIGN KEY ("replaced_by_import_id","user_id") REFERENCES "public"."conversation_import_runs"("id","user_id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "conversation_message_versions_message_created_idx" ON "conversation_message_versions" USING btree ("message_id","created_at" DESC,"id" DESC);
