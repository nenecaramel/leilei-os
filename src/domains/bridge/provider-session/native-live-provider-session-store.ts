import { sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import { providerSessionOwnershipLock } from "./native-live-provider-session-references.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class NativeLiveProviderSessionStoreError extends Error {
  constructor(readonly code: "CLEANUP_IN_PROGRESS", message: string) {
    super(message);
    this.name = "NativeLiveProviderSessionStoreError";
  }
}

/** Transcripts live in the SDK's local files; only the preservation marker is written here. */
export class DrizzleNativeLiveProviderSessionStoreRepository {
  constructor(private readonly db: Database | Transaction) {}

  // Only a trusted native restore path should call this after verifying the
  // selected source. The sticky marker is independent of projection lifetime.
  async preserveExternalSession(input: { userId: string; sessionId: string }): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT ${providerSessionOwnershipLock({ providerSessionId: input.sessionId, wait: true })}`);
      const cleanups = await transaction.execute<{ status: string }>(sql`
        SELECT status FROM native_live_provider_session_cleanups
        WHERE provider = 'claude_code'
          AND provider_session_id = ${input.sessionId}
        FOR UPDATE
      `);
      if (cleanups.some(cleanup => cleanup.status === "reserved")) {
        throw new NativeLiveProviderSessionStoreError("CLEANUP_IN_PROGRESS", "Native session cleanup must finish before restoration.");
      }
      await transaction.execute(sql`
        INSERT INTO native_live_provider_session_store_status
          (user_id, provider_session_id, state, preserve_external_session, updated_at)
        VALUES (${input.userId}::uuid, ${input.sessionId}, 'incomplete', true, now())
        ON CONFLICT (user_id, provider_session_id) DO UPDATE
        SET preserve_external_session = true, updated_at = now()
      `);
      await transaction.execute(sql`
        UPDATE native_live_provider_session_cleanups
        SET status = 'failed', last_error_code = 'EXTERNAL_SESSION_PRESERVED',
            completed_at = now(), updated_at = now()
        WHERE user_id = ${input.userId}::uuid AND provider = 'claude_code'
          AND provider_session_id = ${input.sessionId} AND status = 'pending'
      `);
    });
  }
}
