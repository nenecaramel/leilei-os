import { inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { bridgeEvents } from "../../database/schema.js";
import { RETENTION_BATCH_SIZE } from "../retention/retention-policy.js";

type Database = ReturnType<typeof createDatabase>["db"];

export const BRIDGE_TERMINAL_RETENTION_DAYS = 7;

export async function deleteExpiredBridgeEventsBatch(
  database: Database,
  cutoff: Date,
  limit: number,
): Promise<number> {
  if (!Number.isInteger(limit) || limit <= 0 || limit > RETENTION_BATCH_SIZE) {
    throw new RangeError(
      `limit must be a positive integer no greater than ${RETENTION_BATCH_SIZE}`,
    );
  }

  return database.transaction(async (transaction) => {
    const victims = await transaction.execute<{ id: string }>(sql`
      SELECT id
      FROM bridge_events
      WHERE (status = 'host_sent' AND host_sent_at < ${cutoff.toISOString()}::timestamptz)
         OR (status = 'delivery_unknown' AND delivery_unknown_at < ${cutoff.toISOString()}::timestamptz)
      ORDER BY created_at ASC, id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);
    const ids = victims.map((victim) => victim.id);
    if (ids.length === 0) return 0;
    const deleted = await transaction
      .delete(bridgeEvents)
      .where(inArray(bridgeEvents.id, ids))
      .returning({ id: bridgeEvents.id });
    return deleted.length;
  });
}
