DELETE FROM "runtime_subject_states"
WHERE "kind" = 'bedrock';

ALTER TABLE "runtime_subject_states"
  DROP CONSTRAINT "runtime_subject_states_kind_allowed";

ALTER TABLE "runtime_subject_states"
  ADD CONSTRAINT "runtime_subject_states_kind_allowed"
  CHECK ("kind" IN ('feel', 'memory', 'dream', 'drive', 'thought', 'curiosity', 'topic'));
