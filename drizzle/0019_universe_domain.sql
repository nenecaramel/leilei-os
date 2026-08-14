CREATE TABLE "universe_backups" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "universe_backups_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "universe_backups_data_object" CHECK (jsonb_typeof("universe_backups"."data") = 'object'),
	CONSTRAINT "universe_backups_no_recursive_backups" CHECK (NOT ("universe_backups"."data" ? 'backups'))
);
--> statement-breakpoint
CREATE TABLE "universe_galaxies" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"color" text NOT NULL,
	"order" real NOT NULL,
	CONSTRAINT "universe_galaxies_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "universe_meta" (
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"schema_version" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "universe_meta_user_id_pk" PRIMARY KEY("user_id"),
	CONSTRAINT "universe_meta_schema_version" CHECK ("universe_meta"."schema_version" = 2),
	CONSTRAINT "universe_meta_version_nonnegative" CHECK ("universe_meta"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "universe_nodes" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"content" text NOT NULL,
	"type" text NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"galaxies" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"position" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"importance" text,
	"migration" jsonb,
	CONSTRAINT "universe_nodes_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "universe_nodes_position_object" CHECK (jsonb_typeof("universe_nodes"."position") = 'object')
);
--> statement-breakpoint
CREATE TABLE "universe_relations" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"source" text NOT NULL,
	"target" text NOT NULL,
	"relation_type" text NOT NULL,
	"strength" real NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "universe_relations_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "universe_relations_type_allowed" CHECK ("universe_relations"."relation_type" IN ('related_to', 'supports', 'contradicts', 'extends', 'part_of', 'raises'))
);
--> statement-breakpoint
CREATE TABLE "universe_revisions" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"node_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "universe_revisions_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "universe_revisions_snapshot_object" CHECK (jsonb_typeof("universe_revisions"."snapshot") = 'object')
);
--> statement-breakpoint
ALTER TABLE "universe_backups" ADD CONSTRAINT "universe_backups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "universe_galaxies" ADD CONSTRAINT "universe_galaxies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "universe_meta" ADD CONSTRAINT "universe_meta_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "universe_nodes" ADD CONSTRAINT "universe_nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "universe_relations" ADD CONSTRAINT "universe_relations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "universe_revisions" ADD CONSTRAINT "universe_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "universe_backups_user_created_idx" ON "universe_backups" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "universe_nodes_user_updated_idx" ON "universe_nodes" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "universe_relations_user_source_target_type_uidx" ON "universe_relations" USING btree ("user_id","source","target","relation_type");--> statement-breakpoint
CREATE INDEX "universe_relations_user_nodes_idx" ON "universe_relations" USING btree ("user_id","source","target");--> statement-breakpoint
CREATE INDEX "universe_revisions_user_node_created_idx" ON "universe_revisions" USING btree ("user_id","node_id","created_at" DESC NULLS LAST);
