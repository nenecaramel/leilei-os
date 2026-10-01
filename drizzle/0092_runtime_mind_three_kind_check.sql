DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "runtime_subject_states"
    WHERE "kind" NOT IN ('feel', 'memory', 'thought')
      AND GREATEST("created_at", "updated_at")
        >= TIMESTAMPTZ '2026-09-30 13:24:00+00'
  ) THEN
    RAISE EXCEPTION
      'Cannot contract runtime_subject_states.kind: retired Mind kinds changed after the three-kind production rollout.';
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "runtime_subject_states"
  DROP CONSTRAINT "runtime_subject_states_kind_allowed";
--> statement-breakpoint
ALTER TABLE "runtime_subject_states"
  ADD CONSTRAINT "runtime_subject_states_kind_allowed"
  CHECK ("kind" IN ('feel', 'memory', 'thought'))
  NOT VALID;
