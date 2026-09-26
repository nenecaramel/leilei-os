ALTER TABLE "native_live_background_model_jobs"
  DROP CONSTRAINT "native_live_background_model_jobs_workflow_consistency";
--> statement-breakpoint
ALTER TABLE "native_live_background_model_jobs"
  ADD CONSTRAINT "native_live_background_model_jobs_workflow_consistency"
  CHECK (
    ("workflow_kind" IS NULL
      AND "workflow_run_id" IS NULL
      AND "workflow_payload" IS NULL)
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
    OR
    ("workflow_kind" = 'proactivity_wake'
      AND "workflow_run_id" IS NOT NULL
      AND "workflow_payload" IS NOT NULL
      AND jsonb_typeof("workflow_payload") = 'object'
      AND "task_kind" = 'proactivity_deliberate')
  );
--> statement-breakpoint
ALTER TABLE "native_live_background_model_jobs"
  DROP CONSTRAINT "native_live_background_model_jobs_task_kind_allowed";
--> statement-breakpoint
ALTER TABLE "native_live_background_model_jobs"
  ADD CONSTRAINT "native_live_background_model_jobs_task_kind_allowed"
  CHECK (
    "task_kind" IN (
      'distillation',
      'proactivity_deliberate',
      'topic_resurface_evaluate',
      'topic_resurface_deliberate',
      'topic_resurface_retention'
    )
  );
--> statement-breakpoint
CREATE TABLE "runtime_proactivity_wakes" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "subject_id" text NOT NULL,
  "gate" jsonb NOT NULL,
  "contact_target" text,
  "context_snapshot" jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'created' NOT NULL,
  "model_task_id" uuid,
  "decision" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone,
  CONSTRAINT "runtime_proactivity_wakes_subject_not_blank"
    CHECK (char_length(btrim("subject_id")) > 0),
  CONSTRAINT "runtime_proactivity_wakes_gate_object"
    CHECK (jsonb_typeof("gate") = 'object'),
  CONSTRAINT "runtime_proactivity_wakes_context_object"
    CHECK (jsonb_typeof("context_snapshot") = 'object'),
  CONSTRAINT "runtime_proactivity_wakes_target_not_blank"
    CHECK (
      "contact_target" IS NULL
      OR char_length(btrim("contact_target")) > 0
    ),
  CONSTRAINT "runtime_proactivity_wakes_status_allowed"
    CHECK ("status" IN ('created', 'waiting_model', 'decided')),
  CONSTRAINT "runtime_proactivity_wakes_state_consistency"
    CHECK (
      ("status" = 'created'
        AND "model_task_id" IS NULL
        AND "decision" IS NULL
        AND "decided_at" IS NULL)
      OR
      ("status" = 'waiting_model'
        AND "model_task_id" IS NOT NULL
        AND "decision" IS NULL
        AND "decided_at" IS NULL)
      OR
      ("status" = 'decided'
        AND "decision" IS NOT NULL
        AND jsonb_typeof("decision") = 'object'
        AND "decided_at" IS NOT NULL)
    )
);
--> statement-breakpoint
ALTER TABLE "runtime_proactivity_wakes"
  ADD CONSTRAINT "runtime_proactivity_wakes_user_id_users_id_fk"
  FOREIGN KEY ("user_id")
  REFERENCES "public"."users"("id")
  ON DELETE restrict
  ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "runtime_proactivity_wakes_user_status_created_idx"
  ON "runtime_proactivity_wakes"
  USING btree ("user_id","status","created_at","id");
--> statement-breakpoint
CREATE INDEX "runtime_proactivity_wakes_subject_created_idx"
  ON "runtime_proactivity_wakes"
  USING btree ("user_id","subject_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
