CREATE TABLE "runtime_mind_retirement_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "subject_id" text NOT NULL,
  "kind" varchar(32) NOT NULL,
  "anchor_state_id" uuid NOT NULL,
  "thread_key" text NOT NULL,
  "state_count" integer NOT NULL,
  "terminal_at" timestamp with time zone NOT NULL,
  "retention_hours" double precision NOT NULL,
  "retired_at" timestamp with time zone NOT NULL,
  CONSTRAINT "runtime_mind_retirement_receipts_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "runtime_mind_retirement_receipts_subject_not_blank"
    CHECK (char_length(btrim("subject_id")) > 0),
  CONSTRAINT "runtime_mind_retirement_receipts_kind_allowed"
    CHECK ("kind" IN ('drive', 'thought', 'curiosity', 'topic')),
  CONSTRAINT "runtime_mind_retirement_receipts_thread_not_blank"
    CHECK (char_length(btrim("thread_key")) > 0),
  CONSTRAINT "runtime_mind_retirement_receipts_state_count_positive"
    CHECK ("state_count" > 0),
  CONSTRAINT "runtime_mind_retirement_receipts_retention_positive"
    CHECK ("retention_hours" > 0)
);

CREATE INDEX "runtime_mind_retirement_receipts_user_subject_retired_idx"
  ON "runtime_mind_retirement_receipts"
  USING btree ("user_id", "subject_id", "retired_at" DESC, "id" DESC);
