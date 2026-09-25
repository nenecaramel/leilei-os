ALTER TABLE "native_live_turn_preparations"
  ADD COLUMN "execution_selection" jsonb;
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations"
  ADD CONSTRAINT "native_live_turn_preparations_execution_selection_object"
  CHECK (
    "execution_selection" IS NULL
    OR jsonb_typeof("execution_selection") = 'object'
  );
