CREATE TABLE "resource_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resource_type" varchar(32) NOT NULL,
	"resource_id" uuid NOT NULL,
	"action" varchar(32) NOT NULL,
	"actor_type" varchar(32) NOT NULL,
	"channel" varchar(32) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_lifecycle_events_resource_type_allowed" CHECK ("resource_lifecycle_events"."resource_type" IN ('memory', 'diary', 'task')),
	CONSTRAINT "resource_lifecycle_events_action_allowed" CHECK ("resource_lifecycle_events"."action" IN ('archive', 'restore', 'permanent_delete')),
	CONSTRAINT "resource_lifecycle_events_actor_type_allowed" CHECK ("resource_lifecycle_events"."actor_type" IN ('user', 'assistant', 'system')),
	CONSTRAINT "resource_lifecycle_events_channel_allowed" CHECK ("resource_lifecycle_events"."channel" IN ('web', 'mcp', 'internal')),
	CONSTRAINT "resource_lifecycle_events_metadata_object" CHECK (jsonb_typeof("resource_lifecycle_events"."metadata") = 'object')
);
--> statement-breakpoint
ALTER TABLE "resource_lifecycle_events" ADD CONSTRAINT "resource_lifecycle_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "resource_lifecycle_events_user_created_idx" ON "resource_lifecycle_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "resource_lifecycle_events_resource_created_idx" ON "resource_lifecycle_events" USING btree ("resource_type","resource_id","created_at" DESC NULLS LAST);