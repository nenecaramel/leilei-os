ALTER TABLE "native_live_background_model_jobs"
  DROP CONSTRAINT "native_live_background_model_jobs_workflow_consistency";
ALTER TABLE "native_live_background_model_jobs"
  ADD CONSTRAINT "native_live_background_model_jobs_workflow_consistency"
  CHECK (
    ("workflow_kind" IS NULL AND "workflow_run_id" IS NULL AND "workflow_payload" IS NULL)
    OR
    ("workflow_kind" = 'topic_resurface'
      AND "workflow_run_id" IS NOT NULL
      AND "workflow_payload" IS NOT NULL
      AND jsonb_typeof("workflow_payload") = 'object'
      AND "task_kind" IN (
        'topic_resurface_evaluate',
        'topic_resurface_deliberate',
        'topic_resurface_retention'
      ))
    OR
    ("workflow_kind" = 'distillation'
      AND "workflow_run_id" IS NOT NULL
      AND "workflow_payload" IS NOT NULL
      AND jsonb_typeof("workflow_payload") = 'object'
      AND "task_kind" = 'distillation')
  );
--> statement-breakpoint
ALTER TABLE "native_live_background_model_jobs"
  DROP CONSTRAINT "native_live_background_model_jobs_task_kind_allowed";
ALTER TABLE "native_live_background_model_jobs"
  ADD CONSTRAINT "native_live_background_model_jobs_task_kind_allowed"
  CHECK (
    "task_kind" IN (
      'distillation',
      'topic_resurface_evaluate',
      'topic_resurface_deliberate',
      'topic_resurface_retention'
    )
  );
