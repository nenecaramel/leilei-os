CREATE TABLE "native_live_runtime_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "prepare_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "event_type" varchar(32) NOT NULL,
  "provider_session_id" text,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "native_live_runtime_events"
  ADD CONSTRAINT "native_live_runtime_events_preparation_user_fk"
  FOREIGN KEY ("prepare_id","user_id")
  REFERENCES "public"."native_live_turn_preparations"("id","user_id")
  ON DELETE cascade
  ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "native_live_runtime_events_prepare_sequence_uidx"
  ON "native_live_runtime_events"
  USING btree ("user_id","prepare_id","sequence");
--> statement-breakpoint
CREATE INDEX "native_live_runtime_events_prepare_sequence_idx"
  ON "native_live_runtime_events"
  USING btree ("user_id","prepare_id","sequence");
--> statement-breakpoint
ALTER TABLE "native_live_runtime_events"
  ADD CONSTRAINT "native_live_runtime_events_sequence_positive"
  CHECK ("sequence" > 0);
--> statement-breakpoint
ALTER TABLE "native_live_runtime_events"
  ADD CONSTRAINT "native_live_runtime_events_type_allowed"
  CHECK ("event_type" IN ('session','text','partial_text','tool_use','tool_result','attachment','result','error','runtime'));
--> statement-breakpoint
ALTER TABLE "native_live_runtime_events"
  ADD CONSTRAINT "native_live_runtime_events_provider_session_not_blank"
  CHECK ("provider_session_id" IS NULL OR char_length(btrim("provider_session_id")) > 0);
--> statement-breakpoint
ALTER TABLE "native_live_runtime_events"
  ADD CONSTRAINT "native_live_runtime_events_payload_object"
  CHECK ("payload" IS NULL OR jsonb_typeof("payload") = 'object');
