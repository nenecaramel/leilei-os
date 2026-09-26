CREATE TABLE "native_live_turn_preparations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "operation" varchar(16) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "canonical_user_message_id" uuid NOT NULL,
  "runtime_mode" varchar(16) NOT NULL,
  "parent_provider_session_id" text,
  "prompt" text NOT NULL,
  "mind_prepared" boolean DEFAULT false NOT NULL,
  "status" varchar(32) DEFAULT 'prepared' NOT NULL,
  "result_hash" varchar(64),
  "provider_session_id" text,
  "assistant_message_id" uuid,
  "failure_code" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finalized_at" timestamp with time zone,
  CONSTRAINT "native_live_turn_preparations_operation_allowed" CHECK ("native_live_turn_preparations"."operation" IN ('send', 'retry', 'edit')),
  CONSTRAINT "native_live_turn_preparations_runtime_mode_allowed" CHECK ("native_live_turn_preparations"."runtime_mode" IN ('new', 'fork')),
  CONSTRAINT "native_live_turn_preparations_runtime_parent_consistency" CHECK (
    ("native_live_turn_preparations"."runtime_mode" = 'new' AND "native_live_turn_preparations"."parent_provider_session_id" IS NULL)
    OR
    ("native_live_turn_preparations"."runtime_mode" = 'fork'
      AND "native_live_turn_preparations"."parent_provider_session_id" IS NOT NULL
      AND char_length(btrim("native_live_turn_preparations"."parent_provider_session_id")) > 0)
  ),
  CONSTRAINT "native_live_turn_preparations_request_hash_format" CHECK ("native_live_turn_preparations"."request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "native_live_turn_preparations_prompt_not_blank" CHECK (char_length(btrim("native_live_turn_preparations"."prompt")) > 0),
  CONSTRAINT "native_live_turn_preparations_status_allowed" CHECK ("native_live_turn_preparations"."status" IN ('prepared', 'finalized_success', 'finalized_failure')),
  CONSTRAINT "native_live_turn_preparations_result_hash_format" CHECK ("native_live_turn_preparations"."result_hash" IS NULL OR "native_live_turn_preparations"."result_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "native_live_turn_preparations_result_consistency" CHECK (
    ("native_live_turn_preparations"."status" = 'prepared'
      AND "native_live_turn_preparations"."result_hash" IS NULL
      AND "native_live_turn_preparations"."provider_session_id" IS NULL
      AND "native_live_turn_preparations"."assistant_message_id" IS NULL
      AND "native_live_turn_preparations"."failure_code" IS NULL
      AND "native_live_turn_preparations"."finalized_at" IS NULL)
    OR
    ("native_live_turn_preparations"."status" = 'finalized_success'
      AND "native_live_turn_preparations"."result_hash" IS NOT NULL
      AND "native_live_turn_preparations"."provider_session_id" IS NOT NULL
      AND char_length(btrim("native_live_turn_preparations"."provider_session_id")) > 0
      AND "native_live_turn_preparations"."assistant_message_id" IS NOT NULL
      AND "native_live_turn_preparations"."failure_code" IS NULL
      AND "native_live_turn_preparations"."finalized_at" IS NOT NULL)
    OR
    ("native_live_turn_preparations"."status" = 'finalized_failure'
      AND "native_live_turn_preparations"."result_hash" IS NOT NULL
      AND "native_live_turn_preparations"."provider_session_id" IS NULL
      AND "native_live_turn_preparations"."assistant_message_id" IS NULL
      AND "native_live_turn_preparations"."failure_code" IS NOT NULL
      AND char_length(btrim("native_live_turn_preparations"."failure_code")) > 0
      AND "native_live_turn_preparations"."finalized_at" IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" ADD CONSTRAINT "native_live_turn_preparations_conversation_user_fk" FOREIGN KEY ("conversation_id","user_id") REFERENCES "public"."conversations"("id","user_id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" ADD CONSTRAINT "native_live_turn_preparations_user_message_fk" FOREIGN KEY ("canonical_user_message_id","conversation_id","user_id") REFERENCES "public"."conversation_messages"("id","conversation_id","user_id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" ADD CONSTRAINT "native_live_turn_preparations_assistant_message_fk" FOREIGN KEY ("assistant_message_id","conversation_id","user_id") REFERENCES "public"."conversation_messages"("id","conversation_id","user_id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "native_live_turn_preparations_user_request_uidx" ON "native_live_turn_preparations" USING btree ("user_id","request_id");
CREATE INDEX "native_live_turn_preparations_user_status_created_idx" ON "native_live_turn_preparations" USING btree ("user_id","status","created_at","id");
CREATE INDEX "native_live_turn_preparations_conversation_created_idx" ON "native_live_turn_preparations" USING btree ("conversation_id","created_at","id");
