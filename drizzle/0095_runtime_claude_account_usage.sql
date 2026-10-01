CREATE TABLE "runtime_claude_account_usage_snapshots" (
  "user_id" uuid NOT NULL,
  "provider" varchar(32) NOT NULL,
  "snapshot" jsonb NOT NULL,
  "provider_session_id" text,
  "observed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "runtime_claude_account_usage_snapshots_pk"
    PRIMARY KEY ("user_id","provider"),
  CONSTRAINT "runtime_claude_account_usage_snapshots_user_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE cascade,
  CONSTRAINT "runtime_claude_account_usage_snapshots_provider_allowed"
    CHECK ("provider" IN ('claude_code')),
  CONSTRAINT "runtime_claude_account_usage_snapshots_snapshot_object"
    CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT "runtime_claude_account_usage_snapshots_provider_session_not_blank"
    CHECK ("provider_session_id" IS NULL OR char_length(btrim("provider_session_id")) > 0)
);
