UPDATE "runtime_subject_states"
SET "payload" = jsonb_set(
      "payload",
      '{thought_v1}',
      (("payload" -> 'thought_v1') - 'stage' - 'fixationAt'),
      false
    ),
    "updated_at" = now()
WHERE "kind" = 'thought'
  AND "payload" ? 'thought_v1'
  AND jsonb_typeof("payload" -> 'thought_v1') = 'object';
