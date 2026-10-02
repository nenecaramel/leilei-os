import { sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import { nativeLiveProviderSessionEntries } from "../../../database/schema.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type NativeLiveProviderSessionStoreKey = {
  workspaceId: string;
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
      | "BATCH_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "NativeLiveProviderSessionStoreError";
  }
}

export class DrizzleNativeLiveProviderSessionStoreRepository {
  constructor(private readonly db: Database) {}

  async append(input: {
    userId: string;
    key: NativeLiveProviderSessionStoreKey;
    appendBatchId: string;
    entries: NativeLiveProviderSessionStoreEntry[];
  }): Promise<void> {
    if (input.entries.length === 0) return;
    await this.db
      .insert(nativeLiveProviderSessionEntries)
      .values(
        input.entries.map((entry, appendOrdinal) => ({
          userId: input.userId,
          workspaceId: input.key.workspaceId,
          providerSessionId: input.key.sessionId,
          subpath: input.key.subpath ?? "",
          appendBatchId: input.appendBatchId,
          appendOrdinal,
          entry,
        })),
      )
      .onConflictDoNothing();
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
        AND workspace_id = ${input.key.workspaceId}::uuid
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
    workspaceId: string;
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
        AND workspace_id = ${input.workspaceId}::uuid
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
    if (input.key.subpath !== undefined) {
      await this.db.execute(sql`
        DELETE FROM native_live_provider_session_entries
        WHERE user_id = ${input.userId}::uuid
          AND workspace_id = ${input.key.workspaceId}::uuid
          AND provider_session_id = ${input.key.sessionId}
          AND subpath = ${input.key.subpath}
      `);
      return;
    }
    await this.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        DELETE FROM native_live_provider_session_entries
        WHERE user_id = ${input.userId}::uuid
          AND workspace_id = ${input.key.workspaceId}::uuid
          AND provider_session_id = ${input.key.sessionId}
      `);
      await transaction.execute(sql`
        DELETE FROM native_live_provider_session_store_status
        WHERE user_id = ${input.userId}::uuid
          AND workspace_id = ${input.key.workspaceId}::uuid
          AND provider_session_id = ${input.key.sessionId}
      `);
    });
  }

  async getStatus(input: {
    userId: string;
    workspaceId: string;
    sessionId: string;
  }): Promise<NativeLiveProviderSessionStoreState | null> {
    const rows = await this.db.execute<{ state: NativeLiveProviderSessionStoreState }>(sql`
      SELECT state
      FROM native_live_provider_session_store_status
      WHERE user_id = ${input.userId}::uuid
        AND workspace_id = ${input.workspaceId}::uuid
        AND provider_session_id = ${input.sessionId}
      LIMIT 1
    `);
    return rows[0]?.state ?? null;
  }

  async setStatus(input: {
    userId: string;
    workspaceId: string;
    sessionId: string;
    state: NativeLiveProviderSessionStoreState;
  }): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO native_live_provider_session_store_status (
        user_id,
        workspace_id,
        provider_session_id,
        state,
        updated_at
      )
      VALUES (
        ${input.userId}::uuid,
        ${input.workspaceId}::uuid,
        ${input.sessionId},
        ${input.state},
        now()
      )
      ON CONFLICT (user_id, workspace_id, provider_session_id)
      DO UPDATE SET
        state = EXCLUDED.state,
        updated_at = now()
    `);
  }

  async listSubkeys(input: {
    userId: string;
    workspaceId: string;
    sessionId: string;
  }): Promise<string[]> {
    const rows = await this.db.execute<{ subpath: string }>(sql`
      SELECT DISTINCT subpath
      FROM native_live_provider_session_entries
      WHERE user_id = ${input.userId}::uuid
        AND workspace_id = ${input.workspaceId}::uuid
        AND provider_session_id = ${input.sessionId}
        AND subpath <> ''
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
    if (totalBytes > 7_000_000) {
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
    workspaceId: string;
  }): Promise<NativeLiveProviderSessionStoreListEntry[]> {
    return this.repository.listSessions({
      userId: input.userId,
      workspaceId: normalizeWorkspaceId(input.workspaceId),
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
    workspaceId: string;
    sessionId: string;
  }): Promise<string[]> {
    return this.repository.listSubkeys({
      userId: input.userId,
      workspaceId: normalizeWorkspaceId(input.workspaceId),
      sessionId: normalizeSessionId(input.sessionId),
    });
  }

  getStatus(input: {
    userId: string;
    workspaceId: string;
    sessionId: string;
  }): Promise<NativeLiveProviderSessionStoreState | null> {
    return this.repository.getStatus({
      userId: input.userId,
      workspaceId: normalizeWorkspaceId(input.workspaceId),
      sessionId: normalizeSessionId(input.sessionId),
    });
  }

  markIncomplete(input: {
    userId: string;
    workspaceId: string;
    sessionId: string;
  }): Promise<void> {
    return this.repository.setStatus({
      userId: input.userId,
      workspaceId: normalizeWorkspaceId(input.workspaceId),
      sessionId: normalizeSessionId(input.sessionId),
      state: "incomplete",
    });
  }

  markComplete(input: {
    userId: string;
    workspaceId: string;
    sessionId: string;
  }): Promise<void> {
    return this.repository.setStatus({
      userId: input.userId,
      workspaceId: normalizeWorkspaceId(input.workspaceId),
      sessionId: normalizeSessionId(input.sessionId),
      state: "complete",
    });
  }
}

function normalizeWorkspaceId(value: string): string {
  return normalizeUuid(
    value,
    "SessionStore workspace id is invalid.",
  );
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
  const workspaceId = normalizeWorkspaceId(value?.workspaceId);
  const sessionId = normalizeSessionId(value?.sessionId);
  if (value.subpath === undefined) {
    return { workspaceId, sessionId };
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
    workspaceId,
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
  if (Buffer.byteLength(encoded, "utf8") > 6_500_000) {
    throw new NativeLiveProviderSessionStoreError(
      "BATCH_TOO_LARGE",
      "SessionStore entry is too large.",
    );
  }
  return value;
}
