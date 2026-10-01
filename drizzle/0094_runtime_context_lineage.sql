ALTER TABLE "runtime_context_manifests"
  ADD COLUMN "lineage" jsonb;
--> statement-breakpoint
CREATE TABLE "runtime_context_lineage_states" (
  "canonical_message_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "epoch" integer DEFAULT 0 NOT NULL,
  "seen_state_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "thought_revision" integer DEFAULT 0 NOT NULL,
  "thought_fingerprint" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "runtime_context_lineage_states_message_conversation_user_fk"
    FOREIGN KEY ("canonical_message_id","conversation_id","user_id")
    REFERENCES "public"."conversation_messages"("id","conversation_id","user_id")
    ON DELETE cascade ON UPDATE cascade,
  CONSTRAINT "runtime_context_lineage_states_epoch_nonnegative"
    CHECK ("epoch" >= 0),
  CONSTRAINT "runtime_context_lineage_states_seen_array"
    CHECK (jsonb_typeof("seen_state_ids") = 'array'),
  CONSTRAINT "runtime_context_lineage_states_thought_revision_nonnegative"
    CHECK ("thought_revision" >= 0),
  CONSTRAINT "runtime_context_lineage_states_thought_fingerprint_format"
    CHECK ("thought_fingerprint" IS NULL OR "thought_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "runtime_context_lineage_states_user_conversation_idx"
  ON "runtime_context_lineage_states"
  USING btree ("user_id","conversation_id","updated_at" DESC NULLS LAST);
