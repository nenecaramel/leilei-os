import { sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
type Executor = Pick<ReturnType<typeof createDatabase>["db"], "execute">;

/** A continuation-mode native Session remains on the Mac; storing the same
 * pre-handoff images and documents as JSONB in Railway is unnecessary.
 * Legacy full-history mode remains explicitly available and unchanged.
 */
export async function assertLegacyAssetWriteAllowed(
  db: Executor, input: { userId: string; sessionId: string },
): Promise<void> {
  const rows = await db.execute<{ blocked: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM conversations
      WHERE user_id = ${input.userId}::uuid
        AND origin = 'native_live' AND lifecycle_status = 'active'
        AND provider_metadata->'nativeSessionSource'->>'mode' = 'continuation'
        AND provider_metadata->'nativeSessionSource'->>'sessionId' = ${input.sessionId}
    ) AS blocked
  `);
  if (rows[0]?.blocked) {
    throw Object.assign(new Error("Do not copy native display assets for a continuation-only Session."), {
      code: "LEGACY_ASSET_WRITE_DISABLED",
    });
  }
}
