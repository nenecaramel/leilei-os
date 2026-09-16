ALTER TABLE "conversation_import_runs"
  ADD COLUMN "execution_key" varchar(64) DEFAULT 'standard' NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversation_import_runs"
  ADD CONSTRAINT "conversation_import_runs_execution_key_not_blank"
  CHECK (char_length(btrim("conversation_import_runs"."execution_key")) > 0);
--> statement-breakpoint
DROP INDEX IF EXISTS "conversation_import_runs_source_parser_executed_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_import_runs_execution_executed_uidx"
  ON "conversation_import_runs" USING btree (
    "source_id",
    "parser_version",
    "preview_fingerprint",
    "execution_key"
  )
  WHERE "conversation_import_runs"."status" = 'executed';
