CREATE TABLE "bridge_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"source" varchar(64) NOT NULL,
	"visible_text" text NOT NULL,
	"model_context" text NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reserved_by" uuid,
	"reserved_at" timestamp with time zone,
	"reservation_expires_at" timestamp with time zone,
	"dispatch_started_at" timestamp with time zone,
	"host_sent_at" timestamp with time zone,
	"delivery_unknown_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(64),
	CONSTRAINT "bridge_events_kind_allowed" CHECK ("bridge_events"."kind" = 'chat'),
	CONSTRAINT "bridge_events_source_allowed" CHECK ("bridge_events"."source" = 'leileios_pwa'),
	CONSTRAINT "bridge_events_idempotency_key_format" CHECK ("bridge_events"."idempotency_key" ~ '^[A-Za-z0-9._:-]{16,128}$'),
	CONSTRAINT "bridge_events_request_hash_format" CHECK ("bridge_events"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "bridge_events_visible_text_bounds" CHECK (char_length(btrim("bridge_events"."visible_text")) > 0 AND char_length("bridge_events"."visible_text") <= 4000),
	CONSTRAINT "bridge_events_status_allowed" CHECK ("bridge_events"."status" IN ('pending', 'reserved', 'host_sent', 'delivery_unknown')),
	CONSTRAINT "bridge_events_retry_count_nonnegative" CHECK ("bridge_events"."retry_count" >= 0),
	CONSTRAINT "bridge_events_reserved_fields_required" CHECK ("bridge_events"."status" <> 'reserved' OR ("bridge_events"."reserved_by" IS NOT NULL AND "bridge_events"."reservation_expires_at" IS NOT NULL)),
	CONSTRAINT "bridge_events_host_sent_at_required" CHECK ("bridge_events"."status" <> 'host_sent' OR "bridge_events"."host_sent_at" IS NOT NULL),
	CONSTRAINT "bridge_events_delivery_unknown_at_required" CHECK ("bridge_events"."status" <> 'delivery_unknown' OR "bridge_events"."delivery_unknown_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "bridge_listener_leases" (
	"user_id" uuid NOT NULL,
	"listener_instance_id" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridge_listener_leases_user_id_pk" PRIMARY KEY("user_id")
);
--> statement-breakpoint
ALTER TABLE "bridge_events" ADD CONSTRAINT "bridge_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bridge_listener_leases" ADD CONSTRAINT "bridge_listener_leases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_events_user_idempotency_key_uidx" ON "bridge_events" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "bridge_events_user_status_created_id_idx" ON "bridge_events" USING btree ("user_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "bridge_events_status_host_sent_id_idx" ON "bridge_events" USING btree ("status","host_sent_at","id");--> statement-breakpoint
CREATE INDEX "bridge_listener_leases_expires_idx" ON "bridge_listener_leases" USING btree ("lease_expires_at");