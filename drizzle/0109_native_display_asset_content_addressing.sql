-- One immutable native display asset payload per user + SHA256, rather than
-- repeating its image/document base64 content in each session's history.
-- Existing rows remain readable; this migration deletes or rewrites no data.
CREATE TABLE "native_live_display_asset_payloads" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "content_hash" varchar(64) NOT NULL,
  "entry" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "native_live_display_asset_payloads_pk" PRIMARY KEY ("user_id", "content_hash"),
  CONSTRAINT "native_live_display_asset_payloads_hash_format" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "native_live_display_asset_payloads_entry_object" CHECK (jsonb_typeof("entry") = 'object')
);
