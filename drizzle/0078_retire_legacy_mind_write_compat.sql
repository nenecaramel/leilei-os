DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM runtime_subject_states
    WHERE kind = 'dream'
  ) THEN
    RAISE EXCEPTION
      'Cannot retire Dream compatibility while persisted Dream states remain.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM native_live_mind_followups
    WHERE status IN ('pending', 'processing')
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(intents) AS intent
        WHERE intent ->> 'kind' IN ('dream', 'topic')
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot retire legacy Mind write replay while Dream/Topic follow-ups remain executable.';
  END IF;
END
$$;

ALTER TABLE "runtime_subject_states"
  DROP CONSTRAINT "runtime_subject_states_kind_allowed";

ALTER TABLE "runtime_subject_states"
  ADD CONSTRAINT "runtime_subject_states_kind_allowed"
  CHECK (
    "kind" IN (
      'feel',
      'memory',
      'drive',
      'thought',
      'curiosity',
      'topic'
    )
  );
