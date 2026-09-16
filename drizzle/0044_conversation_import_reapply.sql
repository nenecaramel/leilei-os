DROP INDEX IF EXISTS "conversation_import_runs_source_parser_executed_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_import_runs_source_parser_preview_executed_uidx"
  ON "conversation_import_runs" USING btree ("source_id", "parser_version", "preview_fingerprint")
  WHERE "conversation_import_runs"."status" = 'executed';
