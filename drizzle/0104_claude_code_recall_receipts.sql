CREATE TABLE claude_code_recall_receipts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id text NOT NULL,
  conversation_id text NOT NULL,
  context_epoch integer NOT NULL CHECK (context_epoch >= 0),
  state_ids uuid[] NOT NULL CHECK (cardinality(state_ids) BETWEEN 1 AND 4),
  context_sha256 text NOT NULL CHECK (context_sha256 ~ '^[a-f0-9]{64}$'),
  recalled_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at = recalled_at + interval '24 hours'),
  confirmed_at timestamptz,
  CHECK (conversation_id LIKE 'claude-code:%' AND length(conversation_id) BETWEEN 13 AND 268 AND length(btrim(subject_id)) > 0)
);
--> statement-breakpoint
CREATE INDEX claude_code_recall_expiry_idx ON claude_code_recall_receipts(expires_at);
