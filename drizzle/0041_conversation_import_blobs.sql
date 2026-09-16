CREATE TABLE "conversation_import_blobs" (
  "source_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "encoding" varchar(16) NOT NULL,
  "original_bytes" bigint NOT NULL,
  "stored_bytes" bigint NOT NULL,
  "data" bytea NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_import_blobs_encoding_allowed" CHECK ("conversation_import_blobs"."encoding" IN ('raw', 'gzip')),
  CONSTRAINT "conversation_import_blobs_original_bytes_nonnegative" CHECK ("conversation_import_blobs"."original_bytes" >= 0),
  CONSTRAINT "conversation_import_blobs_stored_bytes_nonnegative" CHECK ("conversation_import_blobs"."stored_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "conversation_import_blobs" ADD CONSTRAINT "conversation_import_blobs_source_user_fk" FOREIGN KEY ("source_id","user_id") REFERENCES "public"."conversation_import_sources"("id","user_id") ON DELETE cascade ON UPDATE cascade;
