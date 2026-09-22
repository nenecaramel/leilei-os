ALTER TABLE "native_live_turn_preparations" ADD CONSTRAINT "native_live_turn_preparations_id_user_unique" UNIQUE("id","user_id");
--> statement-breakpoint
CREATE TABLE "native_live_mind_followups" (
  "prepare_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "assistant_message_id" uuid NOT NULL,
  "operation" varchar(16) NOT NULL,
  "intents" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_by" uuid,
  "locked_until" timestamp with time zone,
  "last_error_name" varchar(128),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "native_live_mind_followups_operation_allowed" CHECK ("native_live_mind_followups"."operation" IN ('send', 'retry', 'edit')),
  CONSTRAINT "native_live_mind_followups_intents_array" CHECK (jsonb_typeof("native_live_mind_followups"."intents") = 'array'),
  CONSTRAINT "native_live_mind_followups_status_allowed" CHECK ("native_live_mind_followups"."status" IN ('pending', 'processing', 'completed')),
  CONSTRAINT "native_live_mind_followups_retry_nonnegative" CHECK ("native_live_mind_followups"."retry_count" >= 0),
  CONSTRAINT "native_live_mind_followups_lock_consistency" CHECK (
    ("native_live_mind_followups"."status" = 'pending'
      AND "native_live_mind_followups"."locked_by" IS NULL
      AND "native_live_mind_followups"."locked_until" IS NULL
      AND "native_live_mind_followups"."completed_at" IS NULL)
    OR
    ("native_live_mind_followups"."status" = 'processing'
      AND "native_live_mind_followups"."locked_by" IS NOT NULL
      AND "native_live_mind_followups"."locked_until" IS NOT NULL
      AND "native_live_mind_followups"."completed_at" IS NULL)
    OR
    ("native_live_mind_followups"."status" = 'completed'
      AND "native_live_mind_followups"."locked_by" IS NULL
      AND "native_live_mind_followups"."locked_until" IS NULL
      AND "native_live_mind_followups"."completed_at" IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "native_live_mind_followups" ADD CONSTRAINT "native_live_mind_followups_preparation_user_fk" FOREIGN KEY ("prepare_id","user_id") REFERENCES "public"."native_live_turn_preparations"("id","user_id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "native_live_mind_followups" ADD CONSTRAINT "native_live_mind_followups_conversation_user_fk" FOREIGN KEY ("conversation_id","user_id") REFERENCES "public"."conversations"("id","user_id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "native_live_mind_followups" ADD CONSTRAINT "native_live_mind_followups_assistant_message_fk" FOREIGN KEY ("assistant_message_id","conversation_id","user_id") REFERENCES "public"."conversation_messages"("id","conversation_id","user_id") ON DELETE cascade ON UPDATE cascade;
CREATE INDEX "native_live_mind_followups_status_available_idx" ON "native_live_mind_followups" USING btree ("status","available_at","created_at","prepare_id");
CREATE INDEX "native_live_mind_followups_user_created_idx" ON "native_live_mind_followups" USING btree ("user_id","created_at","prepare_id");
