CREATE TABLE "native_live_chat_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "object_key" text NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "kind" varchar(16) NOT NULL,
  "status" varchar(16) DEFAULT 'uploading' NOT NULL,
  "bound_message_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ready_at" timestamp with time zone,
  "bound_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "native_live_chat_attachments_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "native_live_chat_attachments_object_key_not_blank"
    CHECK (char_length(btrim("object_key")) > 0),
  CONSTRAINT "native_live_chat_attachments_filename_not_blank"
    CHECK (char_length(btrim("filename")) > 0),
  CONSTRAINT "native_live_chat_attachments_mime_not_blank"
    CHECK (char_length(btrim("mime_type")) > 0),
  CONSTRAINT "native_live_chat_attachments_size_positive"
    CHECK ("size_bytes" > 0),
  CONSTRAINT "native_live_chat_attachments_sha_format"
    CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "native_live_chat_attachments_kind_allowed"
    CHECK ("kind" IN ('image', 'file')),
  CONSTRAINT "native_live_chat_attachments_status_allowed"
    CHECK ("status" IN ('uploading', 'ready', 'bound', 'failed')),
  CONSTRAINT "native_live_chat_attachments_state_consistency"
    CHECK (
      (
        "status" = 'uploading'
        AND "ready_at" IS NULL
        AND "bound_at" IS NULL
        AND "failed_at" IS NULL
        AND "bound_message_id" IS NULL
      ) OR (
        "status" = 'ready'
        AND "ready_at" IS NOT NULL
        AND "bound_at" IS NULL
        AND "failed_at" IS NULL
        AND "bound_message_id" IS NULL
      ) OR (
        "status" = 'bound'
        AND "ready_at" IS NOT NULL
        AND "bound_at" IS NOT NULL
        AND "failed_at" IS NULL
        AND "bound_message_id" IS NOT NULL
      ) OR (
        "status" = 'failed'
        AND "bound_at" IS NULL
        AND "failed_at" IS NOT NULL
        AND "bound_message_id" IS NULL
      )
    )
);

CREATE UNIQUE INDEX "native_live_chat_attachments_user_object_uidx"
  ON "native_live_chat_attachments" ("user_id","object_key");
CREATE INDEX "native_live_chat_attachments_user_status_created_idx"
  ON "native_live_chat_attachments" ("user_id","status","created_at","id");
CREATE INDEX "native_live_chat_attachments_bound_message_idx"
  ON "native_live_chat_attachments" ("user_id","bound_message_id");
