CREATE TABLE "native_live_semantic_scoring_requests" (
  "prepare_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "manifest_id" uuid NOT NULL,
  "assembled_at" timestamp with time zone NOT NULL,
  "snapshot_sequence" integer NOT NULL,
  "query" text NOT NULL,
  "candidates" jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "reserved_by" uuid,
  "reserved_at" timestamp with time zone,
  "reservation_expires_at" timestamp with time zone,
  "scores" jsonb,
  "fallback_code" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "native_live_semantic_scoring_requests_query_not_blank" CHECK (char_length(btrim("native_live_semantic_scoring_requests"."query")) > 0),
  CONSTRAINT "native_live_semantic_scoring_requests_candidates_array" CHECK (jsonb_typeof("native_live_semantic_scoring_requests"."candidates") = 'array' AND jsonb_array_length("native_live_semantic_scoring_requests"."candidates") > 0),
  CONSTRAINT "native_live_semantic_scoring_requests_snapshot_nonnegative" CHECK ("native_live_semantic_scoring_requests"."snapshot_sequence" >= 0),
  CONSTRAINT "native_live_semantic_scoring_requests_status_allowed" CHECK ("native_live_semantic_scoring_requests"."status" IN ('pending', 'reserved', 'completed', 'fallback')),
  CONSTRAINT "native_live_semantic_scoring_requests_state_consistency" CHECK (
    ("native_live_semantic_scoring_requests"."status" = 'pending'
      AND "native_live_semantic_scoring_requests"."reserved_by" IS NULL
      AND "native_live_semantic_scoring_requests"."reserved_at" IS NULL
      AND "native_live_semantic_scoring_requests"."reservation_expires_at" IS NULL
      AND "native_live_semantic_scoring_requests"."scores" IS NULL
      AND "native_live_semantic_scoring_requests"."fallback_code" IS NULL
      AND "native_live_semantic_scoring_requests"."completed_at" IS NULL)
    OR
    ("native_live_semantic_scoring_requests"."status" = 'reserved'
      AND "native_live_semantic_scoring_requests"."reserved_by" IS NOT NULL
      AND "native_live_semantic_scoring_requests"."reserved_at" IS NOT NULL
      AND "native_live_semantic_scoring_requests"."reservation_expires_at" IS NOT NULL
      AND "native_live_semantic_scoring_requests"."scores" IS NULL
      AND "native_live_semantic_scoring_requests"."fallback_code" IS NULL
      AND "native_live_semantic_scoring_requests"."completed_at" IS NULL)
    OR
    ("native_live_semantic_scoring_requests"."status" = 'completed'
      AND "native_live_semantic_scoring_requests"."reserved_by" IS NULL
      AND "native_live_semantic_scoring_requests"."reserved_at" IS NULL
      AND "native_live_semantic_scoring_requests"."reservation_expires_at" IS NULL
      AND "native_live_semantic_scoring_requests"."scores" IS NOT NULL
      AND "native_live_semantic_scoring_requests"."fallback_code" IS NULL
      AND "native_live_semantic_scoring_requests"."completed_at" IS NOT NULL)
    OR
    ("native_live_semantic_scoring_requests"."status" = 'fallback'
      AND "native_live_semantic_scoring_requests"."reserved_by" IS NULL
      AND "native_live_semantic_scoring_requests"."reserved_at" IS NULL
      AND "native_live_semantic_scoring_requests"."reservation_expires_at" IS NULL
      AND "native_live_semantic_scoring_requests"."scores" IS NULL
      AND "native_live_semantic_scoring_requests"."fallback_code" IS NOT NULL
      AND "native_live_semantic_scoring_requests"."completed_at" IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "native_live_semantic_scoring_requests" ADD CONSTRAINT "native_live_semantic_scoring_requests_preparation_user_fk" FOREIGN KEY ("prepare_id","user_id") REFERENCES "public"."native_live_turn_preparations"("id","user_id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "native_live_semantic_scoring_requests" ADD CONSTRAINT "native_live_semantic_scoring_requests_conversation_user_fk" FOREIGN KEY ("conversation_id","user_id") REFERENCES "public"."conversations"("id","user_id") ON DELETE cascade ON UPDATE cascade;
CREATE INDEX "native_live_semantic_scoring_requests_queue_idx" ON "native_live_semantic_scoring_requests" USING btree ("status","created_at","prepare_id");
CREATE INDEX "native_live_semantic_scoring_requests_user_created_idx" ON "native_live_semantic_scoring_requests" USING btree ("user_id","created_at","prepare_id");
