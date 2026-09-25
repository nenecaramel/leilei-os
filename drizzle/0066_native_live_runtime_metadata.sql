ALTER TABLE "native_live_turn_preparations"
  ADD COLUMN "runtime_metadata" jsonb;
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations"
  ADD CONSTRAINT "native_live_turn_preparations_runtime_metadata_object"
  CHECK (
    "runtime_metadata" IS NULL
    OR jsonb_typeof("runtime_metadata") = 'object'
  );
