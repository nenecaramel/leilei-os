-- Keep current-head Runtime observability durable even after terminal turn
-- preparations age out through operational retention.
UPDATE conversation_provider_session_checkpoints AS checkpoint
SET runtime_metadata = preparation.runtime_metadata
FROM native_live_turn_preparations AS preparation
WHERE checkpoint.runtime_metadata IS NULL
  AND preparation.runtime_metadata IS NOT NULL
  AND preparation.status = 'finalized_success'
  AND preparation.user_id = checkpoint.user_id
  AND preparation.conversation_id = checkpoint.conversation_id
  AND preparation.assistant_message_id = checkpoint.canonical_message_id;
