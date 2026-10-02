CREATE TABLE "claude_album_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "object_key" text NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "description" text,
  "why_saved" text NOT NULL,
  "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "source_attachment_id" uuid NOT NULL,
  "source_message_id" uuid,
  "trigger_user_message_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "claude_album_photos_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "claude_album_photos_object_key_not_blank"
    CHECK (char_length(btrim("object_key")) > 0),
  CONSTRAINT "claude_album_photos_filename_not_blank"
    CHECK (char_length(btrim("filename")) > 0),
  CONSTRAINT "claude_album_photos_mime_image"
    CHECK (lower("mime_type") LIKE 'image/%'),
  CONSTRAINT "claude_album_photos_size_positive"
    CHECK ("size_bytes" > 0),
  CONSTRAINT "claude_album_photos_sha_format"
    CHECK ("sha256" ~ ('^[0-9a-f]{64}' || chr(36))),
  CONSTRAINT "claude_album_photos_description_limit"
    CHECK ("description" IS NULL OR char_length("description") <= 2000),
  CONSTRAINT "claude_album_photos_why_saved_bounds"
    CHECK (char_length(btrim("why_saved")) BETWEEN 1 AND 4000),
  CONSTRAINT "claude_album_photos_tags_limit"
    CHECK (cardinality("tags") <= 12)
);

CREATE UNIQUE INDEX "claude_album_photos_user_object_uidx"
  ON "claude_album_photos" ("user_id","object_key");
CREATE UNIQUE INDEX "claude_album_photos_user_source_attachment_uidx"
  ON "claude_album_photos" ("user_id","source_attachment_id");
CREATE INDEX "claude_album_photos_user_created_idx"
  ON "claude_album_photos" ("user_id","created_at" DESC,"id" DESC);
CREATE INDEX "claude_album_photos_user_source_message_idx"
  ON "claude_album_photos" ("user_id","source_message_id");
CREATE INDEX "claude_album_photos_user_trigger_message_idx"
  ON "claude_album_photos" ("user_id","trigger_user_message_id","created_at");
