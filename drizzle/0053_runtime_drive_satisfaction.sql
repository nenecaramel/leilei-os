CREATE TABLE "runtime_drive_satisfaction_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "subject_id" text NOT NULL,
  "drive_state_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "evidence_message_id" uuid NOT NULL,
  "evidence_block_id" uuid,
  "evidence_kind" varchar(32) NOT NULL,
  "amount" double precision NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "runtime_drive_satisfaction_events_subject_not_blank" CHECK (char_length(btrim("runtime_drive_satisfaction_events"."subject_id")) > 0),
  CONSTRAINT "runtime_drive_satisfaction_events_kind_allowed" CHECK ("runtime_drive_satisfaction_events"."evidence_kind" IN ('user_message', 'tool_result')),
  CONSTRAINT "runtime_drive_satisfaction_events_amount_bounds" CHECK ("runtime_drive_satisfaction_events"."amount" > 0 AND "runtime_drive_satisfaction_events"."amount" <= 1),
  CONSTRAINT "runtime_drive_satisfaction_events_idempotency_format" CHECK ("runtime_drive_satisfaction_events"."idempotency_key" ~ '^[A-Za-z0-9._:-]{16,128}$'),
  CONSTRAINT "runtime_drive_satisfaction_events_block_consistency" CHECK (
    ("runtime_drive_satisfaction_events"."evidence_kind" = 'user_message' AND "runtime_drive_satisfaction_events"."evidence_block_id" IS NULL)
    OR
    ("runtime_drive_satisfaction_events"."evidence_kind" = 'tool_result' AND "runtime_drive_satisfaction_events"."evidence_block_id" IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "runtime_drive_satisfaction_events" ADD CONSTRAINT "runtime_drive_satisfaction_events_drive_user_fk" FOREIGN KEY ("drive_state_id","user_id") REFERENCES "public"."runtime_subject_states"("id","user_id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "runtime_drive_satisfaction_events" ADD CONSTRAINT "runtime_drive_satisfaction_events_conversation_user_fk" FOREIGN KEY ("conversation_id","user_id") REFERENCES "public"."conversations"("id","user_id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "runtime_drive_satisfaction_events" ADD CONSTRAINT "runtime_drive_satisfaction_events_message_fk" FOREIGN KEY ("evidence_message_id","conversation_id","user_id") REFERENCES "public"."conversation_messages"("id","conversation_id","user_id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "runtime_drive_satisfaction_events" ADD CONSTRAINT "runtime_drive_satisfaction_events_evidence_block_id_conversation_content_blocks_id_fk" FOREIGN KEY ("evidence_block_id") REFERENCES "public"."conversation_content_blocks"("id") ON DELETE cascade ON UPDATE cascade;
CREATE UNIQUE INDEX "runtime_drive_satisfaction_events_user_idempotency_uidx" ON "runtime_drive_satisfaction_events" USING btree ("user_id","idempotency_key");
CREATE INDEX "runtime_drive_satisfaction_events_drive_created_idx" ON "runtime_drive_satisfaction_events" USING btree ("drive_state_id","created_at","id");
