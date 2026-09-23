ALTER TABLE "native_live_background_model_jobs"
  ADD COLUMN "workflow_kind" varchar(64);
ALTER TABLE "native_live_background_model_jobs"
  ADD COLUMN "workflow_run_id" uuid;
ALTER TABLE "native_live_background_model_jobs"
  ADD COLUMN "workflow_payload" jsonb;
ALTER TABLE "native_live_background_model_jobs"
  ADD COLUMN "consumed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "native_live_background_model_jobs"
  ADD CONSTRAINT "native_live_background_model_jobs_workflow_consistency"
  CHECK (
    ("workflow_kind" IS NULL AND "workflow_run_id" IS NULL AND "workflow_payload" IS NULL)
    OR
    ("workflow_kind" = 'topic_resurface'
      AND "workflow_run_id" IS NOT NULL
      AND "workflow_payload" IS NOT NULL
      AND jsonb_typeof("workflow_payload") = 'object')
  );
ALTER TABLE "native_live_background_model_jobs"
  ADD CONSTRAINT "native_live_background_model_jobs_consumed_consistency"
  CHECK ("consumed_at" IS NULL OR "status" IN ('completed', 'failed'));
CREATE INDEX "native_live_background_model_jobs_workflow_idx"
  ON "native_live_background_model_jobs"
  USING btree ("user_id","subject_id","workflow_kind","consumed_at","created_at","id");
CREATE UNIQUE INDEX "native_live_background_model_jobs_run_stage_uidx"
  ON "native_live_background_model_jobs"
  USING btree ("workflow_run_id","task_kind");
