CREATE TABLE "data_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"package_sha256" varchar(64) NOT NULL,
	"preview_fingerprint" varchar(64) NOT NULL,
	"schema_version" integer NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_import_runs_package_sha256_format" CHECK ("data_import_runs"."package_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "data_import_runs_preview_fingerprint_format" CHECK ("data_import_runs"."preview_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "data_import_runs_summary_object" CHECK (jsonb_typeof("data_import_runs"."summary") = 'object')
);
--> statement-breakpoint
ALTER TABLE "data_import_runs" ADD CONSTRAINT "data_import_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "data_import_runs_user_created_idx" ON "data_import_runs" USING btree ("user_id","created_at" DESC NULLS LAST);