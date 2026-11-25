import { inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { nativeLiveBackgroundModelJobs } from "../../database/schema.js";
import { RETENTION_BATCH_SIZE } from "./retention-policy.js";

type Database = ReturnType<typeof createDatabase>["db"];

/** The queue is retired; its stored, consumed jobs still expire. */
export async function deleteExpiredNativeLiveBackgroundModelJobsBatch(
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
    const victims = await transaction.execute<{ id: string }>(sql`
      SELECT id
      FROM native_live_background_model_jobs
      WHERE status IN ('completed', 'failed')
        AND consumed_at IS NOT NULL
        AND consumed_at < ${cutoff.toISOString()}::timestamptz
      ORDER BY consumed_at ASC, id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);
    const ids = victims.map((victim) => victim.id);
    if (ids.length === 0) return 0;

    const deleted = await transaction
      .delete(nativeLiveBackgroundModelJobs)
      .where(inArray(nativeLiveBackgroundModelJobs.id, ids))
      .returning({ id: nativeLiveBackgroundModelJobs.id });
    return deleted.length;
  });
}
