CREATE TABLE "native_live_external_session_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
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
  CONSTRAINT "native_live_external_session_requests_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "native_live_external_session_requests_status_allowed"
    CHECK ("status" IN (
      'pending','reserved','completed','failed','expired'
    )),
  CONSTRAINT "native_live_external_session_requests_result_array"
    CHECK ("result" IS NULL OR jsonb_typeof("result") = 'array')
);

CREATE INDEX "native_live_external_session_requests_queue_idx"
  ON "native_live_external_session_requests" (
    "user_id","status","created_at","id"
  );

CREATE TABLE "native_live_conversation_provider_bootstraps" (
  "conversation_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" varchar(32) DEFAULT 'claude_code' NOT NULL,
  "source_provider_session_id" text NOT NULL,
  "workspace_id" uuid,
  "effective_workspace_root" text NOT NULL,
  "source_request_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "consumed_at" timestamp with time zone,
  CONSTRAINT "native_live_conversation_provider_bootstraps_conversation_user_fk"
    FOREIGN KEY ("conversation_id","user_id")
    REFERENCES "conversations"("id","user_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "native_live_conversation_provider_bootstraps_request_fk"
    FOREIGN KEY ("source_request_id")
    REFERENCES "native_live_external_session_requests"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "native_live_conversation_provider_bootstraps_provider_allowed"
    CHECK ("provider" = 'claude_code'),
  CONSTRAINT "native_live_conversation_provider_bootstraps_session_not_blank"
    CHECK (char_length(btrim("source_provider_session_id")) > 0),
  CONSTRAINT "native_live_conversation_provider_bootstraps_root_not_blank"
    CHECK (char_length(btrim("effective_workspace_root")) > 0)
);

CREATE INDEX "native_live_conversation_provider_bootstraps_user_idx"
  ON "native_live_conversation_provider_bootstraps" (
    "user_id","created_at","conversation_id"
  );
