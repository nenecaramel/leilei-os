import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { DrizzleNativeLiveProviderSessionStoreRepository } from "../bridge/provider-session/native-live-provider-session-store.js";
import { providerSessionOwnershipLock } from "../bridge/provider-session/native-live-provider-session-references.js";
import { assertLegacyAssetWriteAllowed } from "../bridge/provider-session/native-live-provider-session-storage-policy.js";
import { nativeDisplayAssetSubpath, validateNativeDisplayAssetEntry, validateNativeDisplayAssets } from "./native-session-history-repository.js";

type Database = ReturnType<typeof createDatabase>["db"];
export type NativeDisplayAssetStageInput = {
  userId: string; sessionId: string; revision: string; total: number; offset: number;
  entries: Array<Record<string, unknown> & { type: string }>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code: string) => Object.assign(new Error(code), { code });
export const NATIVE_DISPLAY_ASSET_STAGE_BATCH_BYTES = 16 * 1024 * 1024;

/** Internal only: append one bounded batch of display-asset carriers ahead of a restore.
 * Inert until a restore names this revision; idempotent by position, so a lost
 * response or dropped upload is resumed from the reported stored count.
 */
export async function stageNativeDisplayAssets(db: Database, input: NativeDisplayAssetStageInput): Promise<{ stored: number; complete: boolean }> {
  if (!uuid.test(input.userId) || !uuid.test(input.sessionId) || !/^[0-9a-f]{64}$/.test(input.revision) ||
    !Number.isSafeInteger(input.total) || input.total < 1 || input.total > 10_000 ||
    !Number.isSafeInteger(input.offset) || input.offset < 0 || !Array.isArray(input.entries) ||
    input.offset + input.entries.length > input.total ||
    Buffer.byteLength(JSON.stringify(input.entries)) > NATIVE_DISPLAY_ASSET_STAGE_BATCH_BYTES) throw fail("INVALID_NATIVE_SNAPSHOT");
  const seen = new Set<string>();
  for (const entry of input.entries) validateNativeDisplayAssetEntry(entry, seen);
  const key = { sessionId: input.sessionId, subpath: nativeDisplayAssetSubpath(input.revision) };
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT ${providerSessionOwnershipLock({ providerSessionId: input.sessionId, wait: true })}`);
    await assertLegacyAssetWriteAllowed(tx, { userId: input.userId, sessionId: input.sessionId });
    const count = async () => Number((await tx.execute<{ count: string }>(sql`
      SELECT count(*) AS count FROM native_live_provider_session_entries
      WHERE user_id = ${input.userId}::uuid AND provider_session_id = ${input.sessionId} AND subpath = ${key.subpath}`))[0]?.count ?? 0);
    const reset = () => tx.execute(sql`DELETE FROM native_live_provider_session_entries
      WHERE user_id = ${input.userId}::uuid AND provider_session_id = ${input.sessionId} AND subpath = ${key.subpath}`);
    const store = new DrizzleNativeLiveProviderSessionStoreRepository(tx);
    let stored = await count();
    if (stored > input.total) { await reset(); stored = 0; }
    // A continued session usually carries the same asset set: copy a complete
    // staged copy of this revision server-side instead of uploading it again.
    if (stored === 0) {
      const [donor] = await tx.execute<{ provider_session_id: string }>(sql`
        SELECT provider_session_id FROM native_live_provider_session_entries
        WHERE user_id = ${input.userId}::uuid AND subpath = ${key.subpath} AND provider_session_id <> ${input.sessionId}
        GROUP BY provider_session_id HAVING count(*) = ${input.total} LIMIT 1`);
      if (donor) {
        await tx.execute(sql`INSERT INTO native_live_provider_session_entries
          (user_id, provider_session_id, subpath, append_batch_id, append_ordinal, entry)
          SELECT user_id, ${input.sessionId}, subpath, ${randomUUID()}::uuid, row_number() OVER (ORDER BY id) - 1, entry
          FROM native_live_provider_session_entries
          WHERE user_id = ${input.userId}::uuid AND provider_session_id = ${donor.provider_session_id} AND subpath = ${key.subpath}
          ORDER BY id`);
        stored = await count();
      }
    }
    // Append only the part that extends the stored prefix; never rewrite stored positions.
    if (input.offset <= stored && stored < input.offset + input.entries.length) {
      const entries = input.entries.slice(stored - input.offset);
      await store.append({ userId: input.userId, key, appendBatchId: randomUUID(), entries });
      stored += entries.length;
    }
    if (stored < input.total) return { stored, complete: false };
    // A complete set must hash to its revision; otherwise drop it so a rerun restages cleanly.
    try { validateNativeDisplayAssets(await store.load({ userId: input.userId, key }), input.revision); }
    catch { await reset(); return { stored: 0, complete: false }; }
    return { stored, complete: true };
  });
}
