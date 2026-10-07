CREATE TABLE "native_live_claude_handoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "expected_head_message_id" uuid NOT NULL,
  "source_message_id" uuid NOT NULL,
  "provider_session_id" text NOT NULL,
  "provider_checkpoint_id" text NOT NULL,
  "effective_working_directory" text NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "handoff_session_id" text,
  "reserved_by" uuid,
  "reserved_at" timestamp with time zone,
  "reservation_expires_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "failure_code" varchar(64),
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "native_live_claude_handoffs_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "native_live_claude_handoffs_conversation_user_fk"
    FOREIGN KEY ("conversation_id","user_id")
    REFERENCES "conversations"("id","user_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "native_live_claude_handoffs_source_message_user_fk"
    FOREIGN KEY ("source_message_id","conversation_id","user_id")
    REFERENCES "conversation_messages"("id","conversation_id","user_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "native_live_claude_handoffs_provider_session_not_blank"
    CHECK (char_length(btrim("provider_session_id")) > 0),
  CONSTRAINT "native_live_claude_handoffs_checkpoint_not_blank"
    CHECK (char_length(btrim("provider_checkpoint_id")) > 0),
  CONSTRAINT "native_live_claude_handoffs_working_directory_not_blank"
    CHECK (char_length(btrim("effective_working_directory")) > 0),
  CONSTRAINT "native_live_claude_handoffs_handoff_session_not_blank"
    CHECK (
      "handoff_session_id" IS NULL
      OR char_length(btrim("handoff_session_id")) > 0
    ),
  CONSTRAINT "native_live_claude_handoffs_status_allowed"
    CHECK ("status" IN (
      'pending','reserved','delivery_unknown','completed','failed','stale','expired'
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "native_live_claude_handoffs_active_uidx"
  ON "native_live_claude_handoffs" ("user_id","conversation_id")
  WHERE "status" IN ('pending','reserved','delivery_unknown');
--> statement-breakpoint
CREATE INDEX "native_live_claude_handoffs_queue_idx"
  ON "native_live_claude_handoffs" (
    "user_id","status","created_at","id"
  );
