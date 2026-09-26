CREATE TABLE "native_live_provider_session_cleanups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" varchar(32) NOT NULL,
  "provider_session_id" text NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "reserved_by" uuid,
  "reserved_at" timestamp with time zone,
  "reservation_expires_at" timestamp with time zone,
  "last_error_code" varchar(64),
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "native_live_provider_session_cleanups_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "native_live_provider_session_cleanups_provider_allowed"
    CHECK ("provider" = 'claude_code'),
  CONSTRAINT "native_live_provider_session_cleanups_session_not_blank"
    CHECK (char_length(btrim("provider_session_id")) > 0),
  CONSTRAINT "native_live_provider_session_cleanups_attempt_bounds"
    CHECK ("attempt" BETWEEN 0 AND 5),
  CONSTRAINT "native_live_provider_session_cleanups_status_allowed"
    CHECK ("status" IN ('pending', 'reserved', 'completed', 'failed')),
  CONSTRAINT "native_live_provider_session_cleanups_state_consistency"
    CHECK (
      (
        "status" = 'pending'
        AND "reserved_by" IS NULL
        AND "reserved_at" IS NULL
        AND "reservation_expires_at" IS NULL
        AND "completed_at" IS NULL
      ) OR (
        "status" = 'reserved'
        AND "reserved_by" IS NOT NULL
        AND "reserved_at" IS NOT NULL
        AND "reservation_expires_at" IS NOT NULL
        AND "completed_at" IS NULL
      ) OR (
        "status" = 'completed'
        AND "reserved_by" IS NULL
        AND "reserved_at" IS NULL
        AND "reservation_expires_at" IS NULL
        AND "last_error_code" IS NULL
        AND "completed_at" IS NOT NULL
      ) OR (
        "status" = 'failed'
        AND "reserved_by" IS NULL
        AND "reserved_at" IS NULL
        AND "reservation_expires_at" IS NULL
        AND "last_error_code" IS NOT NULL
        AND "completed_at" IS NOT NULL
      )
    )
);
CREATE UNIQUE INDEX "native_live_provider_session_cleanups_user_session_uidx"
  ON "native_live_provider_session_cleanups"
  USING btree ("user_id", "provider", "provider_session_id");
CREATE INDEX "native_live_provider_session_cleanups_queue_idx"
  ON "native_live_provider_session_cleanups"
  USING btree ("user_id", "status", "created_at", "id");
