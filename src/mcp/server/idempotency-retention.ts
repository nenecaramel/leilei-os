import { inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { mcpWriteIdempotency } from "../../database/schema.js";
import { RETENTION_BATCH_SIZE } from "../../domains/retention/retention-policy.js";

type Database = ReturnType<typeof createDatabase>["db"];

export async function deleteExpiredMcpIdempotencyBatch(
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
      FROM mcp_write_idempotency
      WHERE created_at < ${cutoff}
      ORDER BY created_at ASC, id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);
    const ids = victims.map((victim) => victim.id);
    if (ids.length === 0) return 0;

    const deleted = await transaction
      .delete(mcpWriteIdempotency)
      .where(inArray(mcpWriteIdempotency.id, ids))
      .returning({ id: mcpWriteIdempotency.id });
    return deleted.length;
  });
}
