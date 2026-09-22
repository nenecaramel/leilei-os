ALTER TABLE "native_live_turn_preparations" ADD COLUMN "dispatch_status" varchar(32) DEFAULT 'staged' NOT NULL;
ALTER TABLE "native_live_turn_preparations" ADD COLUMN "reserved_by" uuid;
ALTER TABLE "native_live_turn_preparations" ADD COLUMN "reserved_at" timestamp with time zone;
ALTER TABLE "native_live_turn_preparations" ADD COLUMN "reservation_expires_at" timestamp with time zone;
ALTER TABLE "native_live_turn_preparations" ADD COLUMN "execution_started_at" timestamp with time zone;
ALTER TABLE "native_live_turn_preparations" ADD COLUMN "delivery_unknown_at" timestamp with time zone;
ALTER TABLE "native_live_turn_preparations" ADD COLUMN "dispatch_error_code" varchar(64);
CREATE INDEX "native_live_turn_preparations_dispatch_queue_idx" ON "native_live_turn_preparations" USING btree ("user_id","dispatch_status","created_at","id");
ALTER TABLE "native_live_turn_preparations" ADD CONSTRAINT "native_live_turn_preparations_dispatch_status_allowed" CHECK ("native_live_turn_preparations"."dispatch_status" IN ('staged', 'pending', 'reserved', 'executing', 'delivery_unknown', 'completed', 'rejected'));
ALTER TABLE "native_live_turn_preparations" ADD CONSTRAINT "native_live_turn_preparations_dispatch_reservation_consistency" CHECK (
  ("native_live_turn_preparations"."dispatch_status" IN ('staged', 'pending', 'rejected')
    AND "native_live_turn_preparations"."reserved_by" IS NULL
    AND "native_live_turn_preparations"."reserved_at" IS NULL
    AND "native_live_turn_preparations"."reservation_expires_at" IS NULL
    AND "native_live_turn_preparations"."execution_started_at" IS NULL)
  OR
  ("native_live_turn_preparations"."dispatch_status" = 'reserved'
    AND "native_live_turn_preparations"."reserved_by" IS NOT NULL
    AND "native_live_turn_preparations"."reserved_at" IS NOT NULL
    AND "native_live_turn_preparations"."reservation_expires_at" IS NOT NULL
    AND "native_live_turn_preparations"."execution_started_at" IS NULL)
  OR
  ("native_live_turn_preparations"."dispatch_status" IN ('executing', 'delivery_unknown', 'completed')
    AND "native_live_turn_preparations"."reserved_by" IS NOT NULL
    AND "native_live_turn_preparations"."reserved_at" IS NOT NULL
    AND "native_live_turn_preparations"."reservation_expires_at" IS NOT NULL
    AND "native_live_turn_preparations"."execution_started_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "native_live_runtime_listener_leases" (
  "user_id" uuid NOT NULL,
  "dispatch_target" varchar(32) NOT NULL,
  "listener_instance_id" uuid NOT NULL,
  "lease_expires_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "native_live_runtime_listener_leases_user_target_pk" PRIMARY KEY("user_id","dispatch_target"),
  CONSTRAINT "native_live_runtime_listener_leases_target_allowed" CHECK ("native_live_runtime_listener_leases"."dispatch_target" = 'claude_code')
);
ALTER TABLE "native_live_runtime_listener_leases" ADD CONSTRAINT "native_live_runtime_listener_leases_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;
CREATE INDEX "native_live_runtime_listener_leases_expiry_idx" ON "native_live_runtime_listener_leases" USING btree ("lease_expires_at");
