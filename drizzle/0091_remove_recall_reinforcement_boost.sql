WITH recall_cleanup AS (
  SELECT
    state.id,
    (state.payload->'lifecycle_v1'->>'salience')::double precision AS salience,
    COALESCE((
      SELECT sum((entry->>'currentValue')::double precision)
      FROM jsonb_array_elements(
        state.payload #> '{recall_reinforcement_v1,contributions}'
      ) AS entry
      WHERE jsonb_typeof(entry->'currentValue') = 'number'
    ), 0::double precision) AS recall_value
  FROM runtime_subject_states AS state
  WHERE state.kind IN ('memory', 'feel')
    AND jsonb_typeof(state.payload->'lifecycle_v1') = 'object'
    AND jsonb_typeof(
      state.payload #> '{recall_reinforcement_v1,contributions}'
    ) = 'array'
)
UPDATE runtime_subject_states AS state
SET
  payload = jsonb_set(
    state.payload - 'recall_reinforcement_v1',
    '{lifecycle_v1,salience}',
    to_jsonb(
      GREATEST(
        0::double precision,
        LEAST(
          1::double precision,
          cleanup.salience - cleanup.recall_value
        )
      )
    ),
    false
  ),
  updated_at = now()
FROM recall_cleanup AS cleanup
WHERE state.id = cleanup.id;
