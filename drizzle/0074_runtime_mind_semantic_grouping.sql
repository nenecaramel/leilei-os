CREATE TABLE "runtime_mind_semantic_grouping_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "subject_id" text NOT NULL,
  "kind" varchar(32) NOT NULL,
  "query_state_id" uuid NOT NULL,
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
  CONSTRAINT "runtime_mind_semantic_grouping_subject_not_blank" CHECK (char_length(btrim("runtime_mind_semantic_grouping_requests"."subject_id")) > 0),
  CONSTRAINT "runtime_mind_semantic_grouping_kind_allowed" CHECK ("runtime_mind_semantic_grouping_requests"."kind" IN ('drive', 'thought', 'curiosity', 'topic')),
  CONSTRAINT "runtime_mind_semantic_grouping_query_not_blank" CHECK (char_length(btrim("runtime_mind_semantic_grouping_requests"."query")) > 0),
  CONSTRAINT "runtime_mind_semantic_grouping_candidates_array" CHECK (jsonb_typeof("runtime_mind_semantic_grouping_requests"."candidates") = 'array' AND jsonb_array_length("runtime_mind_semantic_grouping_requests"."candidates") BETWEEN 1 AND 64),
  CONSTRAINT "runtime_mind_semantic_grouping_scores_object" CHECK ("runtime_mind_semantic_grouping_requests"."scores" IS NULL OR jsonb_typeof("runtime_mind_semantic_grouping_requests"."scores") = 'object'),
  CONSTRAINT "runtime_mind_semantic_grouping_status_allowed" CHECK ("runtime_mind_semantic_grouping_requests"."status" IN ('pending', 'reserved', 'completed', 'fallback')),
  CONSTRAINT "runtime_mind_semantic_grouping_fallback_code_allowed" CHECK ("runtime_mind_semantic_grouping_requests"."fallback_code" IS NULL OR "runtime_mind_semantic_grouping_requests"."fallback_code" IN ('E5_PROVIDER_UNAVAILABLE', 'E5_SCORING_FAILED')),
  CONSTRAINT "runtime_mind_semantic_grouping_state_consistency" CHECK (
    ("status" = 'pending' AND "reserved_by" IS NULL AND "reserved_at" IS NULL AND "reservation_expires_at" IS NULL AND "scores" IS NULL AND "fallback_code" IS NULL AND "completed_at" IS NULL)
    OR ("status" = 'reserved' AND "reserved_by" IS NOT NULL AND "reserved_at" IS NOT NULL AND "reservation_expires_at" IS NOT NULL AND "scores" IS NULL AND "fallback_code" IS NULL AND "completed_at" IS NULL)
    OR ("status" = 'completed' AND "reserved_by" IS NULL AND "reserved_at" IS NULL AND "reservation_expires_at" IS NULL AND "scores" IS NOT NULL AND "fallback_code" IS NULL AND "completed_at" IS NOT NULL)
    OR ("status" = 'fallback' AND "reserved_by" IS NULL AND "reserved_at" IS NULL AND "reservation_expires_at" IS NULL AND "scores" IS NULL AND "fallback_code" IS NOT NULL AND "completed_at" IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "runtime_mind_semantic_grouping_requests" ADD CONSTRAINT "runtime_mind_semantic_grouping_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "runtime_mind_semantic_grouping_requests" ADD CONSTRAINT "runtime_mind_semantic_grouping_query_user_fk" FOREIGN KEY ("query_state_id","user_id") REFERENCES "public"."runtime_subject_states"("id","user_id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_mind_semantic_grouping_query_uidx" ON "runtime_mind_semantic_grouping_requests" USING btree ("user_id","subject_id","kind","query_state_id");
--> statement-breakpoint
CREATE INDEX "runtime_mind_semantic_grouping_queue_idx" ON "runtime_mind_semantic_grouping_requests" USING btree ("status","created_at","id");
--> statement-breakpoint
CREATE INDEX "runtime_mind_semantic_grouping_user_kind_idx" ON "runtime_mind_semantic_grouping_requests" USING btree ("user_id","subject_id","kind","completed_at");
