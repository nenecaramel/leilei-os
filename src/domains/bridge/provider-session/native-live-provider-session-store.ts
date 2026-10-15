import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import { nativeLiveProviderSessionEntries } from "../../../database/schema.js";
import { providerSessionOwnershipLock } from "./native-live-provider-session-references.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const MAX_SESSION_STORE_ENTRY_BYTES = 24_000_000;
const MAX_SESSION_STORE_APPEND_BYTES = 28_000_000;

export type NativeLiveProviderSessionStoreKey = {
  sessionId: string;
  subpath?: string;
};

export type NativeLiveProviderSessionStoreEntry =
  Record<string, unknown> & { type: string };

export type NativeLiveProviderSessionStoreListEntry = {
  sessionId: string;
  mtime: number;
};

export type NativeLiveProviderSessionStoreState =
  | "complete"
  | "incomplete";

export class NativeLiveProviderSessionStoreError extends Error {
  constructor(
    readonly code:
      | "INVALID_KEY"
      | "INVALID_ENTRY"
      | "BATCH_TOO_LARGE"
      | "EXTERNAL_SESSION_PRESERVED"
      | "CLEANUP_IN_PROGRESS"
      | "NATIVE_TRANSCRIPT_DIVERGED"
      | "EXTERNAL_SESSION_NOT_PRESERVED"
      | "NATIVE_SESSION_RECOVERY_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "NativeLiveProviderSessionStoreError";
  }
}

export class DrizzleNativeLiveProviderSessionStoreRepository {
  constructor(private readonly db: Database | Transaction) {}

  async append(input: {
    userId: string;
    key: NativeLiveProviderSessionStoreKey;
    appendBatchId: string;
    entries: NativeLiveProviderSessionStoreEntry[];
  }): Promise<void> {
    if (input.entries.length === 0) return;
    await this.db.transaction(async transaction => {
      await transaction.execute(sql`SELECT ${providerSessionOwnershipLock({ providerSessionId: input.key.sessionId, wait: true })}`);
      await transaction
      .insert(nativeLiveProviderSessionEntries)
      .values(
        input.entries.map((entry, appendOrdinal) => ({
          userId: input.userId,
          providerSessionId: input.key.sessionId,
          subpath: input.key.subpath ?? "",
          appendBatchId: input.appendBatchId,
          appendOrdinal,
          entry,
        })),
      )
      .onConflictDoNothing();
    });
  }

  /** Trusted restore only. Native source is authoritative; never replace a
   * diverged cache. Serialize with SDK append and cleanup on the same SID lock.
   * Position, not content alone, identifies records (identical records may recur).
   */
  async synchronizeNativeSnapshot(input: {
    userId: string;
    key: NativeLiveProviderSessionStoreKey;
    entries: NativeLiveProviderSessionStoreEntry[];
  }): Promise<{ inserted: number }> {
    normalizeKey(input.key);
    if (!input.entries.length || input.entries.length > 100_000 ||
      Buffer.byteLength(JSON.stringify(input.entries), "utf8") > 64 * 1024 * 1024) {
      throw new NativeLiveProviderSessionStoreError("BATCH_TOO_LARGE", "Invalid native snapshot size.");
    }
    input.entries.forEach(normalizeEntry);
    return this.db.transaction(async transaction => {
      await transaction.execute(sql`SELECT ${providerSessionOwnershipLock({ providerSessionId: input.key.sessionId, wait: true })}`);
      const [status] = await transaction.execute<{ preserve_external_session: boolean; state: string }>(sql`
        SELECT preserve_external_session, state FROM native_live_provider_session_store_status
        WHERE user_id = ${input.userId}::uuid AND provider_session_id = ${input.key.sessionId}
        FOR UPDATE
      `);
      if (!status?.preserve_external_session) {
        throw new NativeLiveProviderSessionStoreError("EXTERNAL_SESSION_NOT_PRESERVED", "Native source preservation must precede synchronization.");
      }
      const repository = new DrizzleNativeLiveProviderSessionStoreRepository(transaction);
      const old = await repository.load(input) ?? [];
      if (old.length > 0 && status.state !== "complete") {
        throw new NativeLiveProviderSessionStoreError("NATIVE_SESSION_RECOVERY_REQUIRED", "Interrupted transcript durability must be resolved before restoration.");
      }
      if (old.length > input.entries.length || old.some((entry, index) => stableEntryJson(entry) !== stableEntryJson(input.entries[index]))) {
        throw new NativeLiveProviderSessionStoreError("NATIVE_TRANSCRIPT_DIVERGED", "Native transcript is not an exact extension of its durable replica.");
      }
      // Chunk inside one transaction: a partial import cannot become complete.
      for (let offset = old.length; offset < input.entries.length; offset += 100) {
        const entries = input.entries.slice(offset, offset + 100);
        const digest = createHash("sha256").update(stableEntryJson({ userId: input.userId, key: input.key, offset, entries })).digest("hex");
        const appendBatchId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
        await repository.append({ ...input, appendBatchId, entries });
      }
      // Subagent synchronization cannot assert main-transcript completeness.
      if (input.key.subpath === undefined || input.key.subpath === "") {
        await repository.setStatus({ userId: input.userId, sessionId: input.key.sessionId, state: "complete" });
      }
      return { inserted: input.entries.length - old.length };
    });
  }

  async load(input: {
    userId: string;
    key: NativeLiveProviderSessionStoreKey;
  }): Promise<NativeLiveProviderSessionStoreEntry[] | null> {
    const rows = await this.db.execute<{
      entry: NativeLiveProviderSessionStoreEntry;
    }>(sql`
      SELECT entry
      FROM native_live_provider_session_entries
      WHERE user_id = ${input.userId}::uuid
        AND provider_session_id = ${input.key.sessionId}
        AND subpath = ${input.key.subpath ?? ""}
      ORDER BY id ASC
    `);
    return rows.length > 0
      ? rows.map((row) => row.entry)
      : null;
  }

  async listSessions(input: {
    userId: string;
  }): Promise<NativeLiveProviderSessionStoreListEntry[]> {
    const rows = await this.db.execute<{
      session_id: string;
      mtime: string | number;
    }>(sql`
      SELECT
        provider_session_id AS session_id,
        floor(extract(epoch from max(created_at)) * 1000)::bigint AS mtime
      FROM native_live_provider_session_entries
      WHERE user_id = ${input.userId}::uuid
        AND subpath = ''
      GROUP BY provider_session_id
      ORDER BY max(created_at) DESC, provider_session_id ASC
    `);
    return rows.map((row) => ({
      sessionId: row.session_id,
      mtime: Number(row.mtime),
    }));
  }

  async delete(input: {
    userId: string;
    key: NativeLiveProviderSessionStoreKey;
  }): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT ${providerSessionOwnershipLock({ providerSessionId: input.key.sessionId, wait: true })}`);
      const preserved = await transaction.execute<{ preserve_external_session: boolean }>(sql`
        SELECT preserve_external_session
        FROM native_live_provider_session_store_status
        WHERE user_id = ${input.userId}::uuid
          AND provider_session_id = ${input.key.sessionId}
        FOR UPDATE
      `);
      if (preserved[0]?.preserve_external_session) {
        throw new NativeLiveProviderSessionStoreError("EXTERNAL_SESSION_PRESERVED", "External native sessions cannot be deleted by LeileiOS cleanup.");
      }
      if (input.key.subpath !== undefined) {
        await transaction.execute(sql`
          DELETE FROM native_live_provider_session_entries
          WHERE user_id = ${input.userId}::uuid
            AND provider_session_id = ${input.key.sessionId}
            AND subpath = ${input.key.subpath}
        `);
        return;
      }
      await transaction.execute(sql`
        DELETE FROM native_live_provider_session_entries
        WHERE user_id = ${input.userId}::uuid
          AND provider_session_id = ${input.key.sessionId}
      `);
      await transaction.execute(sql`
        DELETE FROM native_live_provider_session_store_status
        WHERE user_id = ${input.userId}::uuid
          AND provider_session_id = ${input.key.sessionId}
      `);
    });
  }

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

  async getStatus(input: {
    userId: string;
    sessionId: string;
  }): Promise<NativeLiveProviderSessionStoreState | null> {
    const rows = await this.db.execute<{ state: NativeLiveProviderSessionStoreState }>(sql`
      SELECT state
      FROM native_live_provider_session_store_status
      WHERE user_id = ${input.userId}::uuid
        AND provider_session_id = ${input.sessionId}
      LIMIT 1
    `);
    return rows[0]?.state ?? null;
  }

  async setStatus(input: {
    userId: string;
    sessionId: string;
    state: NativeLiveProviderSessionStoreState;
  }): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO native_live_provider_session_store_status (
        user_id,
        provider_session_id,
        state,
        updated_at
      )
      VALUES (
        ${input.userId}::uuid,
        ${input.sessionId},
        ${input.state},
        now()
      )
      ON CONFLICT (user_id, provider_session_id)
      DO UPDATE SET
        state = EXCLUDED.state,
        updated_at = now()
    `);
  }

  // Display-only evidence is not a Claude subagent transcript.
  async listSubkeys(input: {
    userId: string;
    sessionId: string;
  }): Promise<string[]> {
    const rows = await this.db.execute<{ subpath: string }>(sql`
      SELECT DISTINCT subpath
      FROM native_live_provider_session_entries
      WHERE user_id = ${input.userId}::uuid
        AND provider_session_id = ${input.sessionId}
        AND subpath <> ''
        AND subpath NOT LIKE 'native-history-assets/%'
      ORDER BY subpath ASC
    `);
    return rows.map((row) => row.subpath);
  }
}

export class NativeLiveProviderSessionStoreService {
  constructor(
    private readonly repository:
      DrizzleNativeLiveProviderSessionStoreRepository,
  ) {}

  async append(input: {
    userId: string;
    key: NativeLiveProviderSessionStoreKey;
    appendBatchId: string;
    entries: NativeLiveProviderSessionStoreEntry[];
  }): Promise<void> {
    const key = normalizeKey(input.key);
    const appendBatchId = normalizeUuid(
      input.appendBatchId,
      "SessionStore append batch id is invalid.",
    );
    if (!Array.isArray(input.entries)) {
      throw new NativeLiveProviderSessionStoreError(
        "INVALID_ENTRY",
        "SessionStore entries must be an array.",
      );
    }
    if (input.entries.length > 500) {
      throw new NativeLiveProviderSessionStoreError(
        "BATCH_TOO_LARGE",
        "SessionStore append batch is too large.",
      );
    }
    let totalBytes = 0;
    const entries = input.entries.map((entry) => {
      const normalized = normalizeEntry(entry);
      let encoded: string;
      try {
        encoded = JSON.stringify(normalized);
      } catch {
        throw new NativeLiveProviderSessionStoreError(
          "INVALID_ENTRY",
          "SessionStore entry must be JSON serializable.",
        );
      }
      totalBytes += Buffer.byteLength(encoded, "utf8");
      return normalized;
    });
    if (totalBytes > MAX_SESSION_STORE_APPEND_BYTES) {
      throw new NativeLiveProviderSessionStoreError(
        "BATCH_TOO_LARGE",
        "SessionStore append batch is too large.",
      );
    }
    await this.repository.append({
      userId: input.userId,
      key,
      appendBatchId,
      entries,
    });
  }

  load(input: {
    userId: string;
    key: NativeLiveProviderSessionStoreKey;
  }): Promise<NativeLiveProviderSessionStoreEntry[] | null> {
    return this.repository.load({
      userId: input.userId,
      key: normalizeKey(input.key),
    });
  }

  listSessions(input: {
    userId: string;
  }): Promise<NativeLiveProviderSessionStoreListEntry[]> {
    return this.repository.listSessions({
      userId: input.userId,
    });
  }

  async delete(input: {
    userId: string;
    key: NativeLiveProviderSessionStoreKey;
  }): Promise<void> {
    await this.repository.delete({
      userId: input.userId,
      key: normalizeKey(input.key),
    });
  }

  listSubkeys(input: {
    userId: string;
    sessionId: string;
  }): Promise<string[]> {
    return this.repository.listSubkeys({
      userId: input.userId,
      sessionId: normalizeSessionId(input.sessionId),
    });
  }

  getStatus(input: {
    userId: string;
    sessionId: string;
  }): Promise<NativeLiveProviderSessionStoreState | null> {
    return this.repository.getStatus({
      userId: input.userId,
      sessionId: normalizeSessionId(input.sessionId),
    });
  }

  markIncomplete(input: {
    userId: string;
    sessionId: string;
  }): Promise<void> {
    return this.repository.setStatus({
      userId: input.userId,
      sessionId: normalizeSessionId(input.sessionId),
      state: "incomplete",
    });
  }

  markComplete(input: {
    userId: string;
    sessionId: string;
  }): Promise<void> {
    return this.repository.setStatus({
      userId: input.userId,
      sessionId: normalizeSessionId(input.sessionId),
      state: "complete",
    });
  }
}

function normalizeUuid(value: string, message: string): string {
  const normalized =
    typeof value === "string" ? value.trim() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      normalized,
    )
  ) {
    throw new NativeLiveProviderSessionStoreError(
      "INVALID_KEY",
      message,
    );
  }
  return normalized;
}

function normalizeSessionId(value: string): string {
  const normalized =
    typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 256) {
    throw new NativeLiveProviderSessionStoreError(
      "INVALID_KEY",
      "SessionStore session id is invalid.",
    );
  }
  return normalized;
}

function normalizeKey(
  value: NativeLiveProviderSessionStoreKey,
): NativeLiveProviderSessionStoreKey {
  const sessionId = normalizeSessionId(value?.sessionId);
  if (value.subpath === undefined) {
    return { sessionId };
  }
  if (
    typeof value.subpath !== "string"
    || value.subpath.length === 0
    || value.subpath.length > 2000
  ) {
    throw new NativeLiveProviderSessionStoreError(
      "INVALID_KEY",
      "SessionStore subpath is invalid.",
    );
  }
  return {
    sessionId,
    subpath: value.subpath,
  };
}

function normalizeEntry(
  value: NativeLiveProviderSessionStoreEntry,
): NativeLiveProviderSessionStoreEntry {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || typeof value.type !== "string"
    || !value.type.trim()
  ) {
    throw new NativeLiveProviderSessionStoreError(
      "INVALID_ENTRY",
      "SessionStore entry must be an object with a type.",
    );
  }
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > MAX_SESSION_STORE_ENTRY_BYTES) {
    throw new NativeLiveProviderSessionStoreError(
      "BATCH_TOO_LARGE",
      "SessionStore entry is too large.",
    );
  }
  return value;
}

// JSONB may reorder object keys; equality must retain array order and values.
function stableEntryJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableEntryJson).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableEntryJson((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}
