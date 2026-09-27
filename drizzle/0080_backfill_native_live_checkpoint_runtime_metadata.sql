-- Provider checkpoints have had a durable runtime_metadata column since 0068,
-- but terminal finalization historically persisted metadata only on the
-- operational turn preparation. Recover the still-available exact metadata
-- before preparation retention removes it. Never invent missing history.
UPDATE "conversation_provider_session_checkpoints" AS checkpoint
SET "runtime_metadata" = preparation."runtime_metadata"
FROM "native_live_turn_preparations" AS preparation
WHERE checkpoint."runtime_metadata" IS NULL
  AND preparation."status" = 'finalized_success'
  AND preparation."runtime_metadata" IS NOT NULL
  AND preparation."user_id" = checkpoint."user_id"
  AND preparation."conversation_id" = checkpoint."conversation_id"
  AND preparation."assistant_message_id" =
    checkpoint."canonical_message_id";
