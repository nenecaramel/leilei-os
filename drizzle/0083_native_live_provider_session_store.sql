CREATE TABLE "native_live_provider_session_entries" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "provider_session_id" text NOT NULL,
  "subpath" text DEFAULT '' NOT NULL,
  "append_batch_id" uuid NOT NULL,
  "append_ordinal" integer NOT NULL,
  "entry" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "native_live_provider_session_entries_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "native_live_provider_session_entries_session_not_blank"
    CHECK (char_length(btrim("provider_session_id")) > 0),
  CONSTRAINT "native_live_provider_session_entries_session_length"
    CHECK (char_length("provider_session_id") <= 256),
  CONSTRAINT "native_live_provider_session_entries_subpath_length"
    CHECK (char_length("subpath") <= 2000),
  CONSTRAINT "native_live_provider_session_entries_append_ordinal_nonnegative"
    CHECK ("append_ordinal" >= 0),
  CONSTRAINT "native_live_provider_session_entries_entry_object"
    CHECK (jsonb_typeof("entry") = 'object')
);--> statement-breakpoint
CREATE INDEX "native_live_provider_session_entries_load_idx"
  ON "native_live_provider_session_entries"
  ("user_id","workspace_id","provider_session_id","subpath","id");--> statement-breakpoint
CREATE INDEX "native_live_provider_session_entries_sessions_idx"
  ON "native_live_provider_session_entries"
  ("user_id","workspace_id","subpath","created_at" DESC,"provider_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "native_live_provider_session_entries_batch_ordinal_uidx"
  ON "native_live_provider_session_entries"
  ("user_id","workspace_id","provider_session_id","subpath","append_batch_id","append_ordinal");--> statement-breakpoint
CREATE TABLE "native_live_provider_session_store_status" (
  "user_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "provider_session_id" text NOT NULL,
  "state" varchar(16) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "native_live_provider_session_store_status_pk"
    PRIMARY KEY ("user_id","workspace_id","provider_session_id"),
  CONSTRAINT "native_live_provider_session_store_status_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "native_live_provider_session_store_status_session_not_blank"
    CHECK (char_length(btrim("provider_session_id")) > 0),
  CONSTRAINT "native_live_provider_session_store_status_session_length"
    CHECK (char_length("provider_session_id") <= 256),
  CONSTRAINT "native_live_provider_session_store_status_state_allowed"
    CHECK ("state" IN ('complete','incomplete'))
);--> statement-breakpoint
CREATE INDEX "native_live_provider_session_store_status_state_idx"
  ON "native_live_provider_session_store_status"
  ("user_id","state","updated_at");
