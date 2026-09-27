ALTER TABLE "native_live_semantic_scoring_requests"
  ADD COLUMN "resume_retry_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "resume_available_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "resume_last_error_name" varchar(128);

CREATE INDEX "native_live_semantic_scoring_requests_resume_idx"
  ON "native_live_semantic_scoring_requests"
  USING btree (
    "status",
    "resume_available_at",
    "completed_at",
    "prepare_id"
  );

ALTER TABLE "native_live_semantic_scoring_requests"
  ADD CONSTRAINT "native_live_semantic_scoring_requests_resume_retry_nonnegative"
  CHECK ("resume_retry_count" >= 0);

ALTER TABLE "native_live_mind_followups"
  DROP CONSTRAINT "native_live_mind_followups_status_allowed";

ALTER TABLE "native_live_mind_followups"
  ADD CONSTRAINT "native_live_mind_followups_status_allowed"
  CHECK ("status" IN ('pending', 'processing', 'completed', 'quarantined'));

ALTER TABLE "native_live_mind_followups"
  DROP CONSTRAINT "native_live_mind_followups_lock_consistency";

ALTER TABLE "native_live_mind_followups"
  ADD CONSTRAINT "native_live_mind_followups_lock_consistency"
  CHECK (
    ("status" = 'pending'
      AND "locked_by" IS NULL
      AND "locked_until" IS NULL
      AND "completed_at" IS NULL)
    OR ("status" = 'processing'
      AND "locked_by" IS NOT NULL
      AND "locked_until" IS NOT NULL
      AND "completed_at" IS NULL)
    OR ("status" = 'completed'
      AND "locked_by" IS NULL
      AND "locked_until" IS NULL
      AND "completed_at" IS NOT NULL)
    OR ("status" = 'quarantined'
      AND "locked_by" IS NULL
      AND "locked_until" IS NULL
      AND "last_error_name" IS NOT NULL
      AND "completed_at" IS NULL)
  );
