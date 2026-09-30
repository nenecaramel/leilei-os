-- Mind is now memory, feel and thought. Drive and Curiosity were folded into
-- Thought, and Topic (derived from Curiosity) was removed with them.
--
-- The retired kinds must be empty before their storage vocabulary is closed.
-- Historical event tables (drive satisfaction, curiosity resolution, state
-- transitions) are kept untouched; nothing new writes to them.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM runtime_subject_states
    WHERE kind IN ('drive', 'curiosity', 'topic')
  ) THEN
    RAISE EXCEPTION
      'Cannot retire Drive/Curiosity/Topic while persisted states of those kinds remain.';
  END IF;
END
$$;

ALTER TABLE "runtime_subject_states"
  DROP CONSTRAINT "runtime_subject_states_kind_allowed";

ALTER TABLE "runtime_subject_states"
  ADD CONSTRAINT "runtime_subject_states_kind_allowed"
  CHECK ("kind" IN ('feel', 'memory', 'thought'));
