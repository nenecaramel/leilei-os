CREATE TABLE "conversation_favorites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" varchar(32) NOT NULL,
  "source_conversation_id" text NOT NULL,
  "conversation_id" uuid NOT NULL,
  "view" varchar(16) DEFAULT 'default' NOT NULL,
  "title" text,
  "note" text,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "conversation_title_snapshot" text,
  "start_message_id" uuid NOT NULL,
  "end_message_id" uuid NOT NULL,
  "start_source_node_id" text NOT NULL,
  "end_source_node_id" text NOT NULL,
  "message_count" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_favorites_id_user_unique" UNIQUE("id","user_id"),
  CONSTRAINT "conversation_favorites_provider_allowed" CHECK ("conversation_favorites"."provider" IN ('chatgpt', 'claude')),
  CONSTRAINT "conversation_favorites_view_allowed" CHECK ("conversation_favorites"."view" IN ('default', 'all')),
  CONSTRAINT "conversation_favorites_source_conversation_not_blank" CHECK (char_length(btrim("conversation_favorites"."source_conversation_id")) > 0),
  CONSTRAINT "conversation_favorites_start_node_not_blank" CHECK (char_length(btrim("conversation_favorites"."start_source_node_id")) > 0),
  CONSTRAINT "conversation_favorites_end_node_not_blank" CHECK (char_length(btrim("conversation_favorites"."end_source_node_id")) > 0),
  CONSTRAINT "conversation_favorites_message_count_bounds" CHECK ("conversation_favorites"."message_count" BETWEEN 1 AND 200),
  CONSTRAINT "conversation_favorites_title_bounds" CHECK ("conversation_favorites"."title" IS NULL OR char_length("conversation_favorites"."title") <= 200),
  CONSTRAINT "conversation_favorites_note_bounds" CHECK ("conversation_favorites"."note" IS NULL OR char_length("conversation_favorites"."note") <= 4000),
  CONSTRAINT "conversation_favorites_tags_array" CHECK (jsonb_typeof("conversation_favorites"."tags") = 'array')
);
--> statement-breakpoint
CREATE TABLE "conversation_favorite_messages" (
  "favorite_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "message_id" uuid NOT NULL,
  "source_node_id" text NOT NULL,
  "source_message_id" text,
  "role" varchar(32) NOT NULL,
  "model" text,
  "source_created_at" timestamp with time zone,
  "display_text" text DEFAULT '' NOT NULL,
  "snapshot" jsonb NOT NULL,
  CONSTRAINT "conversation_favorite_messages_pk" PRIMARY KEY("favorite_id","ordinal"),
  CONSTRAINT "conversation_favorite_messages_ordinal_nonnegative" CHECK ("conversation_favorite_messages"."ordinal" >= 0),
  CONSTRAINT "conversation_favorite_messages_source_node_not_blank" CHECK (char_length(btrim("conversation_favorite_messages"."source_node_id")) > 0),
  CONSTRAINT "conversation_favorite_messages_role_allowed" CHECK ("conversation_favorite_messages"."role" IN ('user', 'assistant', 'system', 'tool', 'reasoning', 'unknown')),
  CONSTRAINT "conversation_favorite_messages_snapshot_object" CHECK (jsonb_typeof("conversation_favorite_messages"."snapshot") = 'object')
);
--> statement-breakpoint
ALTER TABLE "conversation_favorites" ADD CONSTRAINT "conversation_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "conversation_favorite_messages" ADD CONSTRAINT "conversation_favorite_messages_favorite_user_fk" FOREIGN KEY ("favorite_id","user_id") REFERENCES "public"."conversation_favorites"("id","user_id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "conversation_favorites_user_created_idx" ON "conversation_favorites" USING btree ("user_id","created_at" DESC,"id" DESC);
--> statement-breakpoint
CREATE INDEX "conversation_favorites_user_provider_created_idx" ON "conversation_favorites" USING btree ("user_id","provider","created_at" DESC,"id" DESC);
--> statement-breakpoint
CREATE INDEX "conversation_favorites_user_conversation_idx" ON "conversation_favorites" USING btree ("user_id","conversation_id","created_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_favorite_messages_favorite_message_uidx" ON "conversation_favorite_messages" USING btree ("favorite_id","message_id");
--> statement-breakpoint
CREATE INDEX "conversation_favorite_messages_user_message_idx" ON "conversation_favorite_messages" USING btree ("user_id","message_id");
