CREATE TABLE "runtime_curiosity_resolution_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "subject_id" text NOT NULL,
  "curiosity_state_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "requested_resolution_source_id" uuid NOT NULL,
  "result_resolution_source_id" uuid NOT NULL,
  "resolved_at" timestamp with time zone NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "runtime_curiosity_resolution_events_state_user_fk"
    FOREIGN KEY ("curiosity_state_id", "user_id")
    REFERENCES "runtime_subject_states"("id", "user_id")
    ON DELETE cascade ON UPDATE cascade,
  CONSTRAINT "runtime_curiosity_resolution_events_conversation_user_fk"
    FOREIGN KEY ("conversation_id", "user_id")
    REFERENCES "conversations"("id", "user_id")
    ON DELETE cascade ON UPDATE cascade,
  CONSTRAINT "runtime_curiosity_resolution_events_requested_message_fk"
    FOREIGN KEY (
      "requested_resolution_source_id",
      "conversation_id",
      "user_id"
    )
    REFERENCES "conversation_messages"("id", "conversation_id", "user_id")
    ON DELETE cascade ON UPDATE cascade,
  CONSTRAINT "runtime_curiosity_resolution_events_result_message_fk"
    FOREIGN KEY (
      "result_resolution_source_id",
      "conversation_id",
      "user_id"
    )
    REFERENCES "conversation_messages"("id", "conversation_id", "user_id")
    ON DELETE cascade ON UPDATE cascade,
  CONSTRAINT "runtime_curiosity_resolution_events_subject_not_blank"
    CHECK (char_length(btrim("subject_id")) > 0),
  CONSTRAINT "runtime_curiosity_resolution_events_idempotency_format"
    CHECK ("idempotency_key" ~ '^[A-Za-z0-9._:-]{16,128}$')
);

CREATE UNIQUE INDEX "runtime_curiosity_resolution_events_user_idempotency_uidx"
  ON "runtime_curiosity_resolution_events" USING btree ("user_id", "idempotency_key");

CREATE INDEX "runtime_curiosity_resolution_events_state_created_idx"
  ON "runtime_curiosity_resolution_events"
  USING btree ("curiosity_state_id", "created_at", "id");
