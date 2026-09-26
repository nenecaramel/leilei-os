ALTER TABLE "native_live_mind_followups"
  ADD COLUMN "actions" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "native_live_mind_followups"
  ADD COLUMN "receipts" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE "native_live_mind_followups"
  ADD CONSTRAINT "native_live_mind_followups_actions_array"
  CHECK (jsonb_typeof("actions") = 'array');
ALTER TABLE "native_live_mind_followups"
  ADD CONSTRAINT "native_live_mind_followups_receipts_array"
  CHECK (jsonb_typeof("receipts") = 'array');

ALTER TABLE "runtime_drive_satisfaction_events"
  DROP CONSTRAINT "runtime_drive_satisfaction_events_kind_allowed";
ALTER TABLE "runtime_drive_satisfaction_events"
  ADD CONSTRAINT "runtime_drive_satisfaction_events_kind_allowed"
  CHECK ("evidence_kind" IN ('user_message', 'assistant_message', 'tool_result'));

ALTER TABLE "runtime_drive_satisfaction_events"
  DROP CONSTRAINT "runtime_drive_satisfaction_events_block_consistency";
ALTER TABLE "runtime_drive_satisfaction_events"
  ADD CONSTRAINT "runtime_drive_satisfaction_events_block_consistency"
  CHECK (
    ("evidence_kind" IN ('user_message', 'assistant_message') AND "evidence_block_id" IS NULL)
    OR ("evidence_kind" = 'tool_result' AND "evidence_block_id" IS NOT NULL)
  );
