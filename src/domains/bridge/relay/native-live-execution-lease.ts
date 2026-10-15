import { sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import type { NativeLiveExecutionAdmission } from "../protocol/native-live-execution-admission.js";
import { checkNativeLiveExecutionAdmission } from "./native-live-execution-admission.js";
export const NATIVE_LIVE_EXECUTION_LEASE_MS = 60_000;
type Database = ReturnType<typeof createDatabase>["db"];
class RenewalDenied extends Error {}

/** Extend a still-authorized execution, never resurrect a late-result owner. */
export async function renewNativeLiveExecutionLease(db: Database, input: NativeLiveExecutionAdmission & { userId: string }): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async tx => {
        await tx.execute(sql`SET LOCAL statement_timeout='5s'`); await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
        const origin = await tx.execute(sql`SELECT id FROM native_live_turn_preparations WHERE id=${input.reservationId}::uuid AND user_id=${input.userId}::uuid FOR UPDATE`);
        if (!origin.length) return false;
        await tx.execute(sql`SELECT id FROM conversations WHERE id=${input.conversationId}::uuid AND user_id=${input.userId}::uuid FOR UPDATE`);
        await tx.execute(sql`SELECT user_id FROM native_live_runtime_listener_leases WHERE user_id=${input.userId}::uuid AND dispatch_target='claude_code' FOR UPDATE`);
        if (!await checkNativeLiveExecutionAdmission(tx, input)) return false;
        const renewed = await tx.execute(sql`UPDATE native_live_turn_preparations SET reservation_expires_at=clock_timestamp()+${NATIVE_LIVE_EXECUTION_LEASE_MS}*interval '1 millisecond',updated_at=clock_timestamp()
          WHERE id=${input.reservationId}::uuid AND user_id=${input.userId}::uuid AND reserved_by=${input.listenerInstanceId}::uuid
          AND status='prepared' AND dispatch_status='executing' AND reservation_expires_at>clock_timestamp() RETURNING id`);
        if (!renewed.length) throw new RenewalDenied();
        const lease = await tx.execute(sql`UPDATE native_live_runtime_listener_leases SET lease_expires_at=clock_timestamp()+${NATIVE_LIVE_EXECUTION_LEASE_MS}*interval '1 millisecond',updated_at=clock_timestamp()
          WHERE user_id=${input.userId}::uuid AND dispatch_target='claude_code' AND listener_instance_id=${input.listenerInstanceId}::uuid AND lease_expires_at>clock_timestamp() RETURNING user_id`);
        if (!lease.length) throw new RenewalDenied(); // Roll back reservation extension as well.
        return true;
      }, { isolationLevel: "serializable" });
    } catch (error) {
      if (error instanceof RenewalDenied) return false;
      const cause = error as { code?: string; cause?: { code?: string } }; const code = cause.code ?? cause.cause?.code;
      if (attempt === 0 && (code === "40001" || code === "40P01")) continue;
      throw error;
    }
  }
}
