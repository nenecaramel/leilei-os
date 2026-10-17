import { sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { RETENTION_BATCH_SIZE } from "./retention-policy.js";
import {
  validateRuntimeRetentionSpec,
} from "../runtime/lifecycle/runtime-data-lifecycle-contract.js";

type Database = ReturnType<typeof createDatabase>["db"];

export const RUNTIME_OPERATIONAL_RETENTION_DAYS = 30;

export const RUNTIME_OPERATIONAL_RETENTION_SPEC =
  validateRuntimeRetentionSpec({
    dataClass: "operational",
    retentionMode: "ttl",
    ttlMs:
      RUNTIME_OPERATIONAL_RETENTION_DAYS
      * 24
      * 60
      * 60
      * 1_000,
  });

/**
 * Deletes only terminal / safely disposable Runtime execution records.
 *
 * Active, retryable, delivery-unknown, or otherwise unresolved work is not
 * retention-eligible. Those rows must first pass their domain recovery /
 * reconciliation lifecycle instead of being erased by age alone.
 *
 * Child semantic-scoring and Mind-followup records are owned by a turn
 * preparation and cascade when that terminal preparation is removed.
 */
export async function deleteExpiredRuntimeOperationalRecordsBatch(
  db: Database,
  cutoff: Date,
  limit: number,
): Promise<number> {
  if (
    !Number.isInteger(limit)
    || limit <= 0
    || limit > RETENTION_BATCH_SIZE
  ) {
    throw new RangeError(
      `limit must be a positive integer no greater than ${RETENTION_BATCH_SIZE}`,
    );
  }

  return db.transaction(async (transaction) => {
    let remaining = limit;
    let deleted = 0;

    const consume = (count: number): void => {
      deleted += count;
      remaining -= count;
    };

    if (remaining > 0) {
      const rows = await transaction.execute<{ id: string }>(sql`
        WITH victims AS (
          SELECT id
          FROM runtime_effects
          WHERE updated_at < ${cutoff.toISOString()}::timestamptz
            AND (
              status = 'observed'
              OR (status = 'failed' AND retryable = false)
            )
          ORDER BY updated_at ASC, id ASC
          LIMIT ${remaining}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM runtime_effects AS effect
        USING victims
        WHERE effect.id = victims.id
        RETURNING effect.id
      `);
      consume(rows.length);
    }

    if (remaining > 0) {
      const rows = await transaction.execute<{ id: string }>(sql`
        WITH victims AS (
          SELECT wake.id
          FROM runtime_proactivity_wakes AS wake
          WHERE wake.status = 'decided'
            AND wake.decided_at < ${cutoff.toISOString()}::timestamptz
            AND NOT EXISTS (
              SELECT 1
              FROM runtime_effects AS effect
              WHERE effect.source_wake_id = wake.id
            )
          ORDER BY wake.decided_at ASC, wake.id ASC
          LIMIT ${remaining}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM runtime_proactivity_wakes AS wake
        USING victims
        WHERE wake.id = victims.id
        RETURNING wake.id
      `);
      consume(rows.length);
    }

    if (remaining > 0) {
      const rows = await transaction.execute<{ id: string }>(sql`
        WITH victims AS (
          SELECT preparation.id
          FROM native_live_turn_preparations AS preparation
          WHERE preparation.updated_at
              < ${cutoff.toISOString()}::timestamptz
            AND (
              preparation.dispatch_status = 'rejected'
              OR (
                preparation.status IN (
                  'finalized_success',
                  'finalized_failure'
                )
                AND preparation.dispatch_status = 'completed'
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM native_live_mind_followups AS followup
              WHERE followup.prepare_id = preparation.id
                AND followup.status IN ('pending', 'processing')
            )
            AND NOT EXISTS (
              SELECT 1
              FROM native_live_semantic_scoring_requests AS scoring
              WHERE scoring.prepare_id = preparation.id
                AND scoring.status IN ('pending', 'reserved')
            )
            -- Operational events cascade with their source preparation.
            -- A native background B in transport custody is unresolved,
            -- even if its original foreground H finalized 30 days ago.
            -- Never erase the only server-side queued receipt by age alone.
            AND NOT EXISTS (
              SELECT 1
              FROM native_live_runtime_events AS receipt
              WHERE receipt.prepare_id = preparation.id
                AND receipt.user_id = preparation.user_id
                AND receipt.event_type = 'runtime'
                AND receipt.payload->>'kind' = 'persistent_background_receipt_v1'
                AND receipt.payload->>'phase' = 'queued'
            )
          ORDER BY preparation.updated_at ASC, preparation.id ASC
          LIMIT ${remaining}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM native_live_turn_preparations AS preparation
        USING victims
        WHERE preparation.id = victims.id
        RETURNING preparation.id
      `);
      consume(rows.length);
    }

    if (remaining > 0) {
      const rows = await transaction.execute<{ id: string }>(sql`
        WITH victims AS (
          SELECT manifest.id
          FROM runtime_context_manifests AS manifest
          WHERE manifest.created_at
              < ${cutoff.toISOString()}::timestamptz
            AND NOT EXISTS (
              SELECT 1
              FROM native_live_semantic_scoring_requests AS scoring
              WHERE scoring.manifest_id = manifest.id
                AND scoring.status IN ('pending', 'reserved')
            )
          ORDER BY manifest.created_at ASC, manifest.id ASC
          LIMIT ${remaining}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM runtime_context_manifests AS manifest
        USING victims
        WHERE manifest.id = victims.id
        RETURNING manifest.id
      `);
      consume(rows.length);
    }

    if (remaining > 0) {
      const rows = await transaction.execute<{ id: string }>(sql`
        WITH victims AS (
          SELECT id
          FROM runtime_mind_semantic_grouping_requests
          WHERE status IN ('completed', 'fallback')
            AND updated_at < ${cutoff.toISOString()}::timestamptz
          ORDER BY updated_at ASC, id ASC
          LIMIT ${remaining}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM runtime_mind_semantic_grouping_requests AS grouping
        USING victims
        WHERE grouping.id = victims.id
        RETURNING grouping.id
      `);
      consume(rows.length);
    }

    if (remaining > 0) {
      const rows = await transaction.execute<{ id: string }>(sql`
        WITH victims AS (
          SELECT id
          FROM native_live_provider_session_cleanups
          WHERE status IN ('completed', 'failed')
            AND updated_at < ${cutoff.toISOString()}::timestamptz
          ORDER BY updated_at ASC, id ASC
          LIMIT ${remaining}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM native_live_provider_session_cleanups AS cleanup
        USING victims
        WHERE cleanup.id = victims.id
        RETURNING cleanup.id
      `);
      consume(rows.length);
    }

    if (remaining > 0) {
      const rows = await transaction.execute<{ listener_instance_id: string }>(sql`
        WITH victims AS (
          SELECT user_id, dispatch_target
          FROM native_live_runtime_listener_leases
          WHERE lease_expires_at
              < ${cutoff.toISOString()}::timestamptz
          ORDER BY lease_expires_at ASC, user_id ASC
          LIMIT ${remaining}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM native_live_runtime_listener_leases AS lease
        USING victims
        WHERE lease.user_id = victims.user_id
          AND lease.dispatch_target = victims.dispatch_target
        RETURNING lease.listener_instance_id
      `);
      consume(rows.length);
    }

    return deleted;
  });
}
