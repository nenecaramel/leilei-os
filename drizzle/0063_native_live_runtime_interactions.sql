CREATE TABLE "native_live_runtime_interactions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "prepare_id" uuid NOT NULL,
  "listener_instance_id" uuid NOT NULL,
  "kind" varchar(32) NOT NULL,
  "request" jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "response" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "native_live_runtime_interactions"
  ADD CONSTRAINT "native_live_runtime_interactions_preparation_user_fk"
  FOREIGN KEY ("prepare_id","user_id")
  REFERENCES "public"."native_live_turn_preparations"("id","user_id")
  ON DELETE cascade
  ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "native_live_runtime_interactions_turn_status_idx"
  ON "native_live_runtime_interactions"
  USING btree ("user_id","prepare_id","status","created_at","id");
--> statement-breakpoint
ALTER TABLE "native_live_runtime_interactions"
  ADD CONSTRAINT "native_live_runtime_interactions_kind_allowed"
  CHECK ("kind" IN ('permission','question'));
--> statement-breakpoint
ALTER TABLE "native_live_runtime_interactions"
  ADD CONSTRAINT "native_live_runtime_interactions_request_object"
  CHECK (jsonb_typeof("request") = 'object' AND "request" <> '{}'::jsonb);
--> statement-breakpoint
ALTER TABLE "native_live_runtime_interactions"
  ADD CONSTRAINT "native_live_runtime_interactions_status_allowed"
  CHECK ("status" IN ('pending','resolved','cancelled'));
--> statement-breakpoint
ALTER TABLE "native_live_runtime_interactions"
  ADD CONSTRAINT "native_live_runtime_interactions_response_object"
  CHECK ("response" IS NULL OR jsonb_typeof("response") = 'object');
--> statement-breakpoint
ALTER TABLE "native_live_runtime_interactions"
  ADD CONSTRAINT "native_live_runtime_interactions_state_consistency"
  CHECK (
    ("status" = 'pending'
      AND "response" IS NULL
      AND "resolved_at" IS NULL
      AND "cancelled_at" IS NULL)
    OR ("status" = 'resolved'
      AND "response" IS NOT NULL
      AND "resolved_at" IS NOT NULL
      AND "cancelled_at" IS NULL)
    OR ("status" = 'cancelled'
      AND "response" IS NULL
      AND "resolved_at" IS NULL
      AND "cancelled_at" IS NOT NULL)
  );
