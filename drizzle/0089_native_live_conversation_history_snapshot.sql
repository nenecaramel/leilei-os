CREATE TABLE "native_live_conversation_history_snapshots" (
  "conversation_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "source_provider" varchar(32) DEFAULT 'claude_code' NOT NULL,
  "source_provider_session_id" text NOT NULL,
  "source_label" varchar(255),
  "time_zone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
  "messages" jsonb NOT NULL,
  "message_count" integer NOT NULL,
  "first_message_at" timestamp with time zone,
  "last_message_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "native_live_conversation_history_snapshots_conversation_user_fk"
    FOREIGN KEY ("conversation_id","user_id")
    REFERENCES "conversations"("id","user_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "native_live_conversation_history_snapshots_provider_allowed"
    CHECK ("source_provider" = 'claude_code'),
  CONSTRAINT "native_live_conversation_history_snapshots_session_not_blank"
    CHECK (char_length(btrim("source_provider_session_id")) > 0),
  CONSTRAINT "native_live_conversation_history_snapshots_timezone_not_blank"
    CHECK (char_length(btrim("time_zone")) > 0),
  CONSTRAINT "native_live_conversation_history_snapshots_messages_array"
    CHECK (jsonb_typeof("messages") = 'array'),
  CONSTRAINT "native_live_conversation_history_snapshots_count_matches"
    CHECK ("message_count" = jsonb_array_length("messages")),
  CONSTRAINT "native_live_conversation_history_snapshots_nonempty"
    CHECK ("message_count" > 0)
);

CREATE INDEX "native_live_conversation_history_snapshots_user_idx"
  ON "native_live_conversation_history_snapshots" (
    "user_id","created_at","conversation_id"
  );
