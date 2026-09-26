CREATE TABLE "native_live_runtime_controls" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "prepare_id" uuid NOT NULL,
  "kind" varchar(32) NOT NULL,
  "payload" jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "reserved_by" uuid,
  "reserved_at" timestamp with time zone,
  "receipt" jsonb,
  "failure_code" varchar(64),
  "applied_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "native_live_runtime_controls"
  ADD CONSTRAINT "native_live_runtime_controls_preparation_user_fk"
  FOREIGN KEY ("prepare_id","user_id")
  REFERENCES "public"."native_live_turn_preparations"("id","user_id")
  ON DELETE cascade
  ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "native_live_runtime_controls_queue_idx"
  ON "native_live_runtime_controls"
  USING btree ("user_id","prepare_id","status","created_at","id");
--> statement-breakpoint
ALTER TABLE "native_live_runtime_controls"
  ADD CONSTRAINT "native_live_runtime_controls_kind_allowed"
  CHECK ("kind" IN ('mid_turn_input','interrupt'));
--> statement-breakpoint
ALTER TABLE "native_live_runtime_controls"
  ADD CONSTRAINT "native_live_runtime_controls_payload_object"
  CHECK (jsonb_typeof("payload") = 'object');
--> statement-breakpoint
ALTER TABLE "native_live_runtime_controls"
  ADD CONSTRAINT "native_live_runtime_controls_status_allowed"
  CHECK ("status" IN ('pending','reserved','applied','failed'));
--> statement-breakpoint
ALTER TABLE "native_live_runtime_controls"
  ADD CONSTRAINT "native_live_runtime_controls_receipt_object"
  CHECK ("receipt" IS NULL OR jsonb_typeof("receipt") = 'object');
--> statement-breakpoint
ALTER TABLE "native_live_runtime_controls"
  ADD CONSTRAINT "native_live_runtime_controls_state_consistency"
  CHECK (
    ("status" = 'pending'
      AND "reserved_by" IS NULL
      AND "reserved_at" IS NULL
      AND "receipt" IS NULL
      AND "failure_code" IS NULL
      AND "applied_at" IS NULL)
    OR ("status" = 'reserved'
      AND "reserved_by" IS NOT NULL
      AND "reserved_at" IS NOT NULL
      AND "receipt" IS NULL
      AND "failure_code" IS NULL
      AND "applied_at" IS NULL)
    OR ("status" = 'applied'
      AND "reserved_by" IS NOT NULL
      AND "reserved_at" IS NOT NULL
      AND "receipt" IS NOT NULL
      AND "failure_code" IS NULL
      AND "applied_at" IS NOT NULL)
    OR ("status" = 'failed'
      AND "reserved_by" IS NOT NULL
      AND "reserved_at" IS NOT NULL
      AND "receipt" IS NULL
      AND "failure_code" IS NOT NULL
      AND "applied_at" IS NOT NULL)
  );
