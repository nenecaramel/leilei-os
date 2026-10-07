DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "runtime_subject_states"
    WHERE "kind" <> 'memory'
  ) THEN
    RAISE EXCEPTION
      'Cannot tighten runtime_subject_states.kind to memory only: non-memory rows remain.';
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "runtime_subject_states"
  DROP CONSTRAINT "runtime_subject_states_kind_allowed";
--> statement-breakpoint
ALTER TABLE "runtime_subject_states"
  ADD CONSTRAINT "runtime_subject_states_kind_allowed"
  CHECK ("kind" = 'memory')
  NOT VALID;
--> statement-breakpoint
ALTER TABLE "runtime_subject_states"
  VALIDATE CONSTRAINT "runtime_subject_states_kind_allowed";
