-- Restore the original 256-item semantic candidate budget without touching Memory data.
-- Change only the scoring-request CHECK; applied migration history stays immutable.
ALTER TABLE "native_live_semantic_scoring_requests"
  DROP CONSTRAINT "native_live_semantic_scoring_requests_candidates_array",
  ADD CONSTRAINT "native_live_semantic_scoring_requests_candidates_array"
  CHECK (jsonb_typeof("candidates") = 'array'
    AND jsonb_array_length("candidates") BETWEEN 1 AND 256);
