CREATE TABLE "native_live_background_model_jobs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "subject_id" text NOT NULL,
  "task_kind" varchar(64) NOT NULL,
  "prompt_contract_version" varchar(128) NOT NULL,
  "prompt" text NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "reserved_by" uuid,
  "reserved_at" timestamp with time zone,
  "reservation_expires_at" timestamp with time zone,
  "result_text" text,
  "error_code" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "native_live_background_model_jobs_subject_not_blank" CHECK (char_length(btrim("native_live_background_model_jobs"."subject_id")) > 0),
  CONSTRAINT "native_live_background_model_jobs_task_kind_allowed" CHECK ("native_live_background_model_jobs"."task_kind" IN ('topic_resurface_evaluate', 'topic_resurface_deliberate', 'topic_resurface_retention')),
  CONSTRAINT "native_live_background_model_jobs_prompt_contract_not_blank" CHECK (char_length(btrim("native_live_background_model_jobs"."prompt_contract_version")) > 0),
  CONSTRAINT "native_live_background_model_jobs_prompt_not_blank" CHECK (char_length(btrim("native_live_background_model_jobs"."prompt")) > 0),
  CONSTRAINT "native_live_background_model_jobs_status_allowed" CHECK ("native_live_background_model_jobs"."status" IN ('pending', 'reserved', 'completed', 'failed')),
  CONSTRAINT "native_live_background_model_jobs_state_consistency" CHECK (
    ("native_live_background_model_jobs"."status" = 'pending'
      AND "native_live_background_model_jobs"."reserved_by" IS NULL
      AND "native_live_background_model_jobs"."reserved_at" IS NULL
      AND "native_live_background_model_jobs"."reservation_expires_at" IS NULL
      AND "native_live_background_model_jobs"."result_text" IS NULL
      AND "native_live_background_model_jobs"."error_code" IS NULL
      AND "native_live_background_model_jobs"."completed_at" IS NULL)
    OR
    ("native_live_background_model_jobs"."status" = 'reserved'
      AND "native_live_background_model_jobs"."reserved_by" IS NOT NULL
      AND "native_live_background_model_jobs"."reserved_at" IS NOT NULL
      AND "native_live_background_model_jobs"."reservation_expires_at" IS NOT NULL
      AND "native_live_background_model_jobs"."result_text" IS NULL
      AND "native_live_background_model_jobs"."error_code" IS NULL
      AND "native_live_background_model_jobs"."completed_at" IS NULL)
    OR
    ("native_live_background_model_jobs"."status" = 'completed'
      AND "native_live_background_model_jobs"."reserved_by" IS NULL
      AND "native_live_background_model_jobs"."reserved_at" IS NULL
      AND "native_live_background_model_jobs"."reservation_expires_at" IS NULL
      AND "native_live_background_model_jobs"."result_text" IS NOT NULL
      AND char_length(btrim("native_live_background_model_jobs"."result_text")) > 0
      AND "native_live_background_model_jobs"."error_code" IS NULL
      AND "native_live_background_model_jobs"."completed_at" IS NOT NULL)
    OR
    ("native_live_background_model_jobs"."status" = 'failed'
      AND "native_live_background_model_jobs"."reserved_by" IS NULL
      AND "native_live_background_model_jobs"."reserved_at" IS NULL
      AND "native_live_background_model_jobs"."reservation_expires_at" IS NULL
      AND "native_live_background_model_jobs"."result_text" IS NULL
      AND "native_live_background_model_jobs"."error_code" IS NOT NULL
      AND char_length(btrim("native_live_background_model_jobs"."error_code")) > 0
      AND "native_live_background_model_jobs"."completed_at" IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "native_live_background_model_jobs"
  ADD CONSTRAINT "native_live_background_model_jobs_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE cascade;
CREATE INDEX "native_live_background_model_jobs_queue_idx"
  ON "native_live_background_model_jobs"
  USING btree ("user_id","status","created_at","id");
CREATE INDEX "native_live_background_model_jobs_terminal_idx"
  ON "native_live_background_model_jobs"
  USING btree ("status","completed_at","id");
