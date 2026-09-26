ALTER TABLE "runtime_effects"
  DROP CONSTRAINT "runtime_effects_status_allowed";
--> statement-breakpoint
ALTER TABLE "runtime_effects"
  ADD COLUMN "reserved_by" uuid;
--> statement-breakpoint
ALTER TABLE "runtime_effects"
  ADD COLUMN "reserved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "runtime_effects"
  ADD COLUMN "reservation_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "runtime_effects"
  ADD COLUMN "dispatch_started_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "runtime_effects"
SET "status" = 'unknown',
    "attempt" = GREATEST("attempt", 1),
    "dispatch_started_at" = COALESCE("updated_at", now()),
    "retryable" = false,
    "failure_code" = COALESCE(
      "failure_code",
      'LEGACY_DISPATCHED_STATE'
    )
WHERE "status" = 'dispatched';
--> statement-breakpoint
UPDATE "runtime_effects"
SET "attempt" = GREATEST("attempt", 1),
    "dispatch_started_at" = COALESCE(
      "dispatch_started_at",
      "observed_at",
      "updated_at",
      now()
    ),
    "retryable" = false,
    "failure_code" = NULL
WHERE "status" = 'observed';
--> statement-breakpoint
UPDATE "runtime_effects"
SET "attempt" = GREATEST("attempt", 1),
    "dispatch_started_at" = COALESCE(
      "dispatch_started_at",
      "updated_at",
      now()
    ),
    "failure_code" = COALESCE(
      NULLIF(btrim("failure_code"), ''),
      'LEGACY_FAILED_STATE'
    )
WHERE "status" = 'failed';
--> statement-breakpoint
UPDATE "runtime_effects"
SET "attempt" = GREATEST("attempt", 1),
    "dispatch_started_at" = COALESCE(
      "dispatch_started_at",
      "updated_at",
      now()
    ),
    "retryable" = false,
    "failure_code" = COALESCE(
      NULLIF(btrim("failure_code"), ''),
      'LEGACY_UNKNOWN_STATE'
    )
WHERE "status" = 'unknown';
--> statement-breakpoint
ALTER TABLE "runtime_effects"
  ADD CONSTRAINT "runtime_effects_status_allowed"
  CHECK (
    "status" IN (
      'pending',
      'reserved',
      'dispatching',
      'observed',
      'failed',
      'unknown'
    )
  );
--> statement-breakpoint
ALTER TABLE "runtime_effects"
  ADD CONSTRAINT "runtime_effects_state_consistency"
  CHECK (
    ("status" = 'pending'
      AND "reserved_by" IS NULL
      AND "reserved_at" IS NULL
      AND "reservation_expires_at" IS NULL
      AND "dispatch_started_at" IS NULL
      AND "observed_at" IS NULL
      AND "failure_code" IS NULL
      AND "retryable" = true)
    OR
    ("status" = 'reserved'
      AND "reserved_by" IS NOT NULL
      AND "reserved_at" IS NOT NULL
      AND "reservation_expires_at" IS NOT NULL
      AND "dispatch_started_at" IS NULL
      AND "observed_at" IS NULL
      AND "failure_code" IS NULL
      AND "retryable" = true)
    OR
    ("status" = 'dispatching'
      AND "reserved_by" IS NOT NULL
      AND "reserved_at" IS NOT NULL
      AND "reservation_expires_at" IS NOT NULL
      AND "dispatch_started_at" IS NOT NULL
      AND "observed_at" IS NULL
      AND "failure_code" IS NULL
      AND "retryable" = true
      AND "attempt" > 0)
    OR
    ("status" = 'observed'
      AND "reserved_by" IS NULL
      AND "reserved_at" IS NULL
      AND "reservation_expires_at" IS NULL
      AND "dispatch_started_at" IS NOT NULL
      AND "observed_at" IS NOT NULL
      AND "failure_code" IS NULL
      AND "retryable" = false
      AND "attempt" > 0)
    OR
    ("status" = 'failed'
      AND "reserved_by" IS NULL
      AND "reserved_at" IS NULL
      AND "reservation_expires_at" IS NULL
      AND "dispatch_started_at" IS NOT NULL
      AND "observed_at" IS NULL
      AND "failure_code" IS NOT NULL
      AND char_length(btrim("failure_code")) > 0
      AND "attempt" > 0)
    OR
    ("status" = 'unknown'
      AND "reserved_by" IS NULL
      AND "reserved_at" IS NULL
      AND "reservation_expires_at" IS NULL
      AND "dispatch_started_at" IS NOT NULL
      AND "observed_at" IS NULL
      AND "failure_code" IS NOT NULL
      AND char_length(btrim("failure_code")) > 0
      AND "retryable" = false
      AND "attempt" > 0)
  );
