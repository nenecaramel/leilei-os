-- Execution receipts retain the original executor for safe duplicate acknowledgement.
-- Pre-execution rejections carry no reservation; only FINALIZE_CONFLICT can retain one.
ALTER TABLE "native_live_turn_preparations"
  DROP CONSTRAINT "native_live_turn_preparations_dispatch_reservation_consistency";
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations"
  ADD CONSTRAINT "native_live_turn_preparations_dispatch_reservation_consistency"
  CHECK (("dispatch_status" IN ('staged', 'pending')
          AND "reserved_by" IS NULL
          AND "reserved_at" IS NULL
          AND "reservation_expires_at" IS NULL
          AND "execution_started_at" IS NULL)
        OR ("dispatch_status" = 'rejected'
          AND "reserved_by" IS NULL
          AND "reserved_at" IS NULL
          AND "reservation_expires_at" IS NULL
          AND "execution_started_at" IS NULL
          AND "dispatch_error_code" IS DISTINCT FROM 'FINALIZE_CONFLICT')
        OR ("dispatch_status" = 'rejected'
          AND "reserved_by" IS NOT NULL
          AND "reserved_at" IS NOT NULL
          AND "reservation_expires_at" IS NULL
          AND "execution_started_at" IS NOT NULL
          AND "dispatch_error_code" IS NOT DISTINCT FROM 'FINALIZE_CONFLICT')
        OR ("dispatch_status" = 'reserved'
          AND "reserved_by" IS NOT NULL
          AND "reserved_at" IS NOT NULL
          AND "reservation_expires_at" IS NOT NULL
          AND "execution_started_at" IS NULL)
        OR ("dispatch_status" IN ('executing', 'delivery_unknown', 'completed')
          AND "reserved_by" IS NOT NULL
          AND "reserved_at" IS NOT NULL
          AND "reservation_expires_at" IS NOT NULL
          AND "execution_started_at" IS NOT NULL));
