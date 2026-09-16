CREATE TABLE "conversation_exclusions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" varchar(32) NOT NULL,
  "scope" varchar(32) NOT NULL,
  "source_conversation_id" text NOT NULL,
  "source_node_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_exclusions_provider_allowed" CHECK ("conversation_exclusions"."provider" IN ('chatgpt', 'claude')),
  CONSTRAINT "conversation_exclusions_scope_allowed" CHECK ("conversation_exclusions"."scope" IN ('conversation', 'branch')),
  CONSTRAINT "conversation_exclusions_source_conversation_not_blank" CHECK (char_length(btrim("conversation_exclusions"."source_conversation_id")) > 0),
  CONSTRAINT "conversation_exclusions_scope_node_consistency" CHECK (("conversation_exclusions"."scope" = 'conversation' AND "conversation_exclusions"."source_node_id" IS NULL) OR ("conversation_exclusions"."scope" = 'branch' AND "conversation_exclusions"."source_node_id" IS NOT NULL AND char_length(btrim("conversation_exclusions"."source_node_id")) > 0))
);
--> statement-breakpoint
ALTER TABLE "conversation_exclusions" ADD CONSTRAINT "conversation_exclusions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_exclusions_conversation_uidx" ON "conversation_exclusions" USING btree ("user_id","provider","source_conversation_id") WHERE "conversation_exclusions"."scope" = 'conversation';
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_exclusions_branch_uidx" ON "conversation_exclusions" USING btree ("user_id","provider","source_conversation_id","source_node_id") WHERE "conversation_exclusions"."scope" = 'branch' AND "conversation_exclusions"."source_node_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "conversation_exclusions_user_provider_idx" ON "conversation_exclusions" USING btree ("user_id","provider","source_conversation_id");
