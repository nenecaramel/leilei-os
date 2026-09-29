CREATE TABLE "native_live_manual_compactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "expected_head_message_id" uuid NOT NULL,
  "source_message_id" uuid NOT NULL,
  "provider_session_id" text NOT NULL,
  "workspace_id" uuid,
  "effective_workspace_root" text,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "reserved_by" uuid,
  "reserved_at" timestamp with time zone,
  "reservation_expires_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "result" jsonb,
  "failure_code" varchar(64),
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "native_live_manual_compactions_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "native_live_manual_compactions_conversation_user_fk"
    FOREIGN KEY ("conversation_id","user_id")
    REFERENCES "conversations"("id","user_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "native_live_manual_compactions_source_message_user_fk"
    FOREIGN KEY ("source_message_id","conversation_id","user_id")
    REFERENCES "conversation_messages"("id","conversation_id","user_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "native_live_manual_compactions_provider_session_not_blank"
    CHECK (char_length(btrim("provider_session_id")) > 0),
  CONSTRAINT "native_live_manual_compactions_workspace_root_not_blank"
    CHECK (
      "effective_workspace_root" IS NULL
      OR char_length(btrim("effective_workspace_root")) > 0
    ),
  CONSTRAINT "native_live_manual_compactions_result_object"
    CHECK ("result" IS NULL OR jsonb_typeof("result") = 'object'),
  CONSTRAINT "native_live_manual_compactions_status_allowed"
    CHECK ("status" IN (
      'pending','reserved','completed','failed','stale','expired'
    ))
);

CREATE UNIQUE INDEX "native_live_manual_compactions_active_uidx"
  ON "native_live_manual_compactions" ("user_id","conversation_id")
  WHERE "status" IN ('pending','reserved');

CREATE INDEX "native_live_manual_compactions_queue_idx"
  ON "native_live_manual_compactions" (
    "user_id","status","created_at","id"
  );
