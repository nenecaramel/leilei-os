CREATE TABLE "runtime_subject_states" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "subject_id" text NOT NULL,
  "kind" varchar(32) NOT NULL,
  "text" text,
  "payload" jsonb,
  "scope_applicability" varchar(32) NOT NULL,
  "scope_conversation_id" uuid,
  "scope_path_head_message_id" uuid,
  "settlement_status" varchar(32) NOT NULL,
  "path_status" varchar(32) NOT NULL,
  "validity_status" varchar(32) NOT NULL,
  "envelope" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "runtime_subject_states_id_user_unique" UNIQUE("id","user_id"),
  CONSTRAINT "runtime_subject_states_subject_not_blank" CHECK (char_length(btrim("subject_id")) > 0),
  CONSTRAINT "runtime_subject_states_kind_allowed" CHECK ("kind" IN ('feel', 'memory', 'dream', 'bedrock', 'drive', 'thought', 'curiosity', 'topic')),
  CONSTRAINT "runtime_subject_states_scope_allowed" CHECK ("scope_applicability" IN ('global', 'conversation', 'path')),
  CONSTRAINT "runtime_subject_states_settlement_allowed" CHECK ("settlement_status" IN ('unsettled', 'settled', 'rejected')),
  CONSTRAINT "runtime_subject_states_path_status_allowed" CHECK ("path_status" IN ('current', 'superseded')),
  CONSTRAINT "runtime_subject_states_validity_allowed" CHECK ("validity_status" IN ('valid', 'invalidated', 'tombstoned')),
  CONSTRAINT "runtime_subject_states_scope_consistency" CHECK (
    ("scope_applicability" = 'global' AND "scope_conversation_id" IS NULL AND "scope_path_head_message_id" IS NULL)
    OR ("scope_applicability" = 'conversation' AND "scope_conversation_id" IS NOT NULL AND "scope_path_head_message_id" IS NULL)
    OR ("scope_applicability" = 'path' AND "scope_conversation_id" IS NOT NULL AND "scope_path_head_message_id" IS NOT NULL)
  ),
  CONSTRAINT "runtime_subject_states_content_present" CHECK (
    ("text" IS NOT NULL AND char_length(btrim("text")) > 0)
    OR ("payload" IS NOT NULL AND jsonb_typeof("payload") = 'object' AND "payload" <> '{}'::jsonb)
  ),
  CONSTRAINT "runtime_subject_states_payload_object" CHECK ("payload" IS NULL OR jsonb_typeof("payload") = 'object'),
  CONSTRAINT "runtime_subject_states_envelope_object" CHECK (jsonb_typeof("envelope") = 'object')
);
ALTER TABLE "runtime_subject_states" ADD CONSTRAINT "runtime_subject_states_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;
CREATE INDEX "runtime_subject_states_user_subject_kind_idx" ON "runtime_subject_states" USING btree ("user_id","subject_id","kind","updated_at" DESC);
CREATE INDEX "runtime_subject_states_scope_idx" ON "runtime_subject_states" USING btree ("user_id","subject_id","scope_conversation_id","settlement_status","validity_status");
--> statement-breakpoint
CREATE TABLE "runtime_subject_state_transitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "subject_id" text NOT NULL,
  "state_id" uuid NOT NULL,
  "reason" varchar(64) NOT NULL,
  "before_envelope" jsonb NOT NULL,
  "after_envelope" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "runtime_subject_state_transitions_subject_not_blank" CHECK (char_length(btrim("subject_id")) > 0),
  CONSTRAINT "runtime_subject_state_transitions_reason_not_blank" CHECK (char_length(btrim("reason")) > 0),
  CONSTRAINT "runtime_subject_state_transitions_before_object" CHECK (jsonb_typeof("before_envelope") = 'object'),
  CONSTRAINT "runtime_subject_state_transitions_after_object" CHECK (jsonb_typeof("after_envelope") = 'object')
);
ALTER TABLE "runtime_subject_state_transitions" ADD CONSTRAINT "runtime_subject_state_transitions_state_user_fk" FOREIGN KEY ("state_id","user_id") REFERENCES "public"."runtime_subject_states"("id","user_id") ON DELETE cascade ON UPDATE cascade;
CREATE INDEX "runtime_subject_state_transitions_state_created_idx" ON "runtime_subject_state_transitions" USING btree ("state_id","created_at","id");
--> statement-breakpoint
CREATE TABLE "runtime_context_manifests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "subject_id" text NOT NULL,
  "conversation_id" uuid NOT NULL,
  "path_head_message_id" uuid,
  "snapshot_sequence" integer NOT NULL,
  "assembly_version" varchar(64) NOT NULL,
  "prompt_contract_version" varchar(64) NOT NULL,
  "budget" jsonb NOT NULL,
  "items" jsonb NOT NULL,
  "assembled_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "runtime_context_manifests_subject_not_blank" CHECK (char_length(btrim("subject_id")) > 0),
  CONSTRAINT "runtime_context_manifests_snapshot_nonnegative" CHECK ("snapshot_sequence" >= 0),
  CONSTRAINT "runtime_context_manifests_assembly_not_blank" CHECK (char_length(btrim("assembly_version")) > 0),
  CONSTRAINT "runtime_context_manifests_prompt_not_blank" CHECK (char_length(btrim("prompt_contract_version")) > 0),
  CONSTRAINT "runtime_context_manifests_budget_object" CHECK (jsonb_typeof("budget") = 'object'),
  CONSTRAINT "runtime_context_manifests_items_array" CHECK (jsonb_typeof("items") = 'array')
);
ALTER TABLE "runtime_context_manifests" ADD CONSTRAINT "runtime_context_manifests_conversation_user_fk" FOREIGN KEY ("conversation_id","user_id") REFERENCES "public"."conversations"("id","user_id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "runtime_context_manifests" ADD CONSTRAINT "runtime_context_manifests_head_conversation_user_fk" FOREIGN KEY ("path_head_message_id","conversation_id","user_id") REFERENCES "public"."conversation_messages"("id","conversation_id","user_id") ON DELETE cascade ON UPDATE cascade;
CREATE INDEX "runtime_context_manifests_user_subject_created_idx" ON "runtime_context_manifests" USING btree ("user_id","subject_id","created_at" DESC,"id" DESC);
