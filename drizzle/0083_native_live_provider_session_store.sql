CREATE TABLE "native_live_provider_session_entries" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "provider_session_id" text NOT NULL,
  "subpath" text,
  "entry" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "native_live_provider_session_entries_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "native_live_provider_session_entries_session_not_blank"
    CHECK (char_length(btrim("provider_session_id")) > 0),
  CONSTRAINT "native_live_provider_session_entries_session_length"
    CHECK (char_length("provider_session_id") <= 256),
  CONSTRAINT "native_live_provider_session_entries_subpath_not_blank"
    CHECK ("subpath" IS NULL OR char_length("subpath") > 0),
  CONSTRAINT "native_live_provider_session_entries_subpath_length"
    CHECK ("subpath" IS NULL OR char_length("subpath") <= 2000),
  CONSTRAINT "native_live_provider_session_entries_entry_object"
    CHECK (jsonb_typeof("entry") = 'object')
);--> statement-breakpoint
CREATE INDEX "native_live_provider_session_entries_load_idx"
  ON "native_live_provider_session_entries"
  ("user_id","workspace_id","provider_session_id","subpath","id");--> statement-breakpoint
CREATE INDEX "native_live_provider_session_entries_sessions_idx"
  ON "native_live_provider_session_entries"
  ("user_id","workspace_id","subpath","created_at" DESC,"provider_session_id");
