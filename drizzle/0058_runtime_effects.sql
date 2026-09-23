ALTER TABLE "runtime_proactivity_wakes"
  ADD CONSTRAINT "runtime_proactivity_wakes_id_user_unique"
  UNIQUE ("id","user_id");
--> statement-breakpoint
CREATE TABLE "runtime_effects" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "subject_id" text NOT NULL,
  "source_wake_id" uuid NOT NULL,
  "decision_id" text NOT NULL,
  "idempotency_key" varchar(64) NOT NULL,
  "effect_type" varchar(64) NOT NULL,
  "target" text NOT NULL,
  "payload" jsonb NOT NULL,
  "payload_hash" varchar(64) NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "retryable" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "observed_at" timestamp with time zone,
  "failure_code" varchar(128),
  CONSTRAINT "runtime_effects_subject_not_blank"
    CHECK (char_length(btrim("subject_id")) > 0),
  CONSTRAINT "runtime_effects_decision_not_blank"
    CHECK (char_length(btrim("decision_id")) > 0),
  CONSTRAINT "runtime_effects_idempotency_format"
    CHECK ("idempotency_key" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "runtime_effects_type_allowed"
    CHECK ("effect_type" = 'message_send'),
  CONSTRAINT "runtime_effects_target_not_blank"
    CHECK (char_length(btrim("target")) > 0),
  CONSTRAINT "runtime_effects_payload_object"
    CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "runtime_effects_payload_hash_format"
    CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "runtime_effects_status_allowed"
    CHECK ("status" IN ('pending', 'dispatched', 'observed', 'failed', 'unknown')),
  CONSTRAINT "runtime_effects_attempt_nonnegative"
    CHECK ("attempt" >= 0)
);
--> statement-breakpoint
ALTER TABLE "runtime_effects"
  ADD CONSTRAINT "runtime_effects_user_id_users_id_fk"
  FOREIGN KEY ("user_id")
  REFERENCES "public"."users"("id")
  ON DELETE restrict
  ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "runtime_effects"
  ADD CONSTRAINT "runtime_effects_wake_user_fk"
  FOREIGN KEY ("source_wake_id","user_id")
  REFERENCES "public"."runtime_proactivity_wakes"("id","user_id")
  ON DELETE restrict
  ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_effects_user_idempotency_uidx"
  ON "runtime_effects"
  USING btree ("user_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_effects_source_wake_uidx"
  ON "runtime_effects"
  USING btree ("source_wake_id");
--> statement-breakpoint
CREATE INDEX "runtime_effects_user_status_created_idx"
  ON "runtime_effects"
  USING btree ("user_id","status","created_at","id");
