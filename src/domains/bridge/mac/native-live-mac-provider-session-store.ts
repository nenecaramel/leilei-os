import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
type FetchLike = typeof fetch;

export type NativeLiveMacSessionStoreKey = {
  projectKey: string;
  sessionId: string;
  subpath?: string;
};

export type NativeLiveMacSessionStoreEntry =
  Record<string, unknown> & { type: string };

export class NativeLiveMacProviderSessionStore {
  private readonly baseUrl: string;
  private readonly retryAppendBatches = new Map<
    string,
    { batchIds: string[]; sessionId: string }
  >();

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly receiptDirectory: string | null = null,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    if (!this.baseUrl) {
      throw new Error("Native Live session store base URL is required.");
    }
    if (!token.trim()) {
      throw new Error("Native Live session store token is required.");
    }
  }

  async append(
    key: NativeLiveMacSessionStoreKey,
    entries: NativeLiveMacSessionStoreEntry[],
    logicalAppendId?: string,
  ): Promise<void> {
    if (entries.length === 0) return;
    if (logicalAppendId !== undefined && (!logicalAppendId.trim() || logicalAppendId.length > 256)) {
      throw new Error("SessionStore logical append id is invalid.");
    }
    const remoteKey = this.remoteKey(key);
    const chunks = chunkAppendEntries(entries);
    const signature = appendSignature(remoteKey, entries, logicalAppendId);
    const stableIntent = Boolean(logicalAppendId) || entries.some((entry) => typeof entry.uuid === "string" && entry.uuid.trim());
    const inProcess = this.retryAppendBatches.get(signature);
    const recovered = inProcess ? undefined : this.readReceipt(signature);
    if (recovered && !stableIntent) {
      // The SDK supplies no operation identity for UUID-less markers. Reusing a
      // content-matched receipt could swallow a genuinely new identical append.
      throw new Error("Ambiguous UUID-less append recovery requires a logicalAppendId.");
    }
    const pending = inProcess ?? recovered;
    const receipt =
      pending
      ?? {
        batchIds: chunks.map((_, index) => stableIntent ? stableAppendBatchId(signature, index) : randomUUID()),
        sessionId: remoteKey.session_id,
      };
    if (!pending) this.writeReceipt(signature, receipt);
    this.retryAppendBatches.set(signature, receipt);

    for (let index = 0; index < chunks.length; index += 1) {
      await this.post("/append", {
        key: remoteKey,
        append_batch_id: receipt.batchIds[index],
        entries: chunks[index],
      });
    }

    if (this.retryAppendBatches.get(signature) === receipt) {
      this.removeReceipt(signature);
      this.retryAppendBatches.delete(signature);
    }
  }

  discardPendingAppends(sessionId: string): void {
    // SDK mirror_error proves neither rollback nor non-commit. Durable receipts
    // must survive it; a later exact retry still needs the original chunk IDs.
    if (this.receiptDirectory) return;
    const normalized = normalizeSessionId(sessionId);
    for (const [signature, pending] of this.retryAppendBatches) {
      if (pending.sessionId === normalized) {
        this.retryAppendBatches.delete(signature);
      }
    }
  }

  async load(
    key: NativeLiveMacSessionStoreKey,
  ): Promise<NativeLiveMacSessionStoreEntry[] | null> {
    const data = readRecord(
      await this.post("/load", { key: this.remoteKey(key) }),
    );
    if (data.entries === null) return null;
    if (!Array.isArray(data.entries)) {
      throw new Error("Native Live session store load response is invalid.");
    }
    return data.entries.map((entry) => {
      const record = readRecord(entry);
      if (typeof record.type !== "string" || !record.type.trim()) {
        throw new Error("Native Live session store entry is invalid.");
      }
      return record as NativeLiveMacSessionStoreEntry;
    });
  }

  async listSessions(
    _projectKey: string,
  ): Promise<Array<{ sessionId: string; mtime: number }>> {
    const data = readRecord(
      await this.post("/list-sessions", {
      }),
    );
    if (!Array.isArray(data.sessions)) {
      throw new Error("Native Live session store list response is invalid.");
    }
    return data.sessions.map((value) => {
      const record = readRecord(value);
      if (
        typeof record.sessionId !== "string"
        || !record.sessionId.trim()
        || typeof record.mtime !== "number"
        || !Number.isFinite(record.mtime)
      ) {
        throw new Error("Native Live session store session entry is invalid.");
      }
      return {
        sessionId: record.sessionId,
        mtime: record.mtime,
      };
    });
  }

  async delete(key: NativeLiveMacSessionStoreKey): Promise<void> {
    await this.post("/delete", { key: this.remoteKey(key) });
  }

  async getStatus(
    sessionId: string,
  ): Promise<"complete" | "incomplete" | null> {
    const data = readRecord(
      await this.post("/status", {
        session_id: normalizeSessionId(sessionId),
      }),
    );
    if (data.state === null) return null;
    if (data.state !== "complete" && data.state !== "incomplete") {
      throw new Error("Native Live session store status is invalid.");
    }
    return data.state;
  }

  async markIncomplete(sessionId: string): Promise<void> {
    await this.markStatus(sessionId, "incomplete");
  }

  async markComplete(sessionId: string): Promise<void> {
    await this.markStatus(sessionId, "complete");
  }

  async listSubkeys(input: {
    projectKey: string;
    sessionId: string;
  }): Promise<string[]> {
    const data = readRecord(
      await this.post("/list-subkeys", {
        session_id: normalizeSessionId(input.sessionId),
      }),
    );
    if (
      !Array.isArray(data.subkeys)
      || data.subkeys.some((value) => typeof value !== "string")
    ) {
      throw new Error("Native Live session store subkeys response is invalid.");
    }
    return data.subkeys as string[];
  }

  private receiptPath(signature: string): string | null {
    if (!this.receiptDirectory) return null;
    const scope = createHash("sha256").update(JSON.stringify([this.baseUrl, this.token])).digest("hex");
    return join(this.receiptDirectory, scope, `${signature}.json`);
  }

  private readReceipt(signature: string): { batchIds: string[]; sessionId: string } | undefined {
    const path = this.receiptPath(signature);
    if (!path || !existsSync(path)) return undefined;
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(receipt.batchIds) || receipt.batchIds.some((id: unknown) => typeof id !== "string" || !/^[a-f0-9-]{36}$/u.test(id)) || typeof receipt.sessionId !== "string") {
      throw new Error("Invalid durable SessionStore append receipt.");
    }
    return receipt;
  }

  private writeReceipt(signature: string, receipt: { batchIds: string[]; sessionId: string }): void {
    const path = this.receiptPath(signature);
    if (!path) return;
    const directory = join(path, "..");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(receipt)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    this.syncReceiptDirectory(directory);
  }

  private removeReceipt(signature: string): void {
    const path = this.receiptPath(signature);
    if (!path) return;
    unlinkSync(path);
    this.syncReceiptDirectory(join(path, ".."));
  }

  private syncReceiptDirectory(directory: string): void {
    const fd = openSync(directory, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }

  private async markStatus(
    sessionId: string,
    state: "complete" | "incomplete",
  ): Promise<void> {
    const data = readRecord(
      await this.post(
        state === "complete" ? "/mark-complete" : "/mark-incomplete",
        {
          session_id: normalizeSessionId(sessionId),
        },
      ),
    );
    if (data.state !== state) {
      throw new Error("Native Live session store status response is invalid.");
    }
  }

  private remoteKey(key: NativeLiveMacSessionStoreKey) {
    return {
      session_id: normalizeSessionId(key.sessionId),
      ...(key.subpath === undefined
        ? {}
        : { subpath: normalizeSubpath(key.subpath) }),
    };
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetchImpl(
      this.baseUrl + "/internal/native-live-session-store" + path,
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + this.token,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Native Live session store returned malformed JSON.");
    }
    const record = readRecord(payload);
    if (!response.ok || record.success !== true) {
      const error =
        record.error
        && typeof record.error === "object"
        && !Array.isArray(record.error)
          ? record.error as Record<string, unknown>
          : {};
      throw Object.assign(
        new Error("Native Live session store request failed."),
        {
          sessionStoreCode:
            typeof error.code === "string" ? error.code : null,
          httpStatus: response.status,
        },
      );
    }
    return record.data;
  }
}

function normalizeSessionId(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 256) {
    throw new Error("Native Live session store session id is invalid.");
  }
  return normalized;
}

function normalizeSubpath(value: string): string {
  if (!value || value.length > 2_000) {
    throw new Error("Native Live session store subpath is invalid.");
  }
  return value;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Native Live session store response is invalid.");
  }
  return value as Record<string, unknown>;
}

const MAX_APPEND_CHUNK_BYTES = 6_000_000;

function chunkAppendEntries(
  entries: NativeLiveMacSessionStoreEntry[],
): NativeLiveMacSessionStoreEntry[][] {
  const chunks: NativeLiveMacSessionStoreEntry[][] = [];
  let chunk: NativeLiveMacSessionStoreEntry[] = [];
  let chunkBytes = 0;

  for (const entry of entries) {
    const entryBytes = Buffer.byteLength(
      JSON.stringify(entry),
      "utf8",
    );
    if (
      chunk.length > 0
      && chunkBytes + entryBytes > MAX_APPEND_CHUNK_BYTES
    ) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(entry);
    chunkBytes += entryBytes;
  }

  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  return chunks;
}

function appendSignature(
  key: { session_id: string; subpath?: string },
  entries: NativeLiveMacSessionStoreEntry[],
  logicalAppendId?: string,
): string {
  return createHash("sha256")
    .update(stableJson({ key, entries, ...(logicalAppendId ? { logicalAppendId } : {}) }))
    .digest("hex");
}


// A stable SDK UUID (or explicit caller intent) names a logical append, so ACK
// delivery and even receipt cleanup cannot change its server idempotency keys.
function stableAppendBatchId(signature: string, index: number): string {
  const hex = createHash("sha256").update(JSON.stringify(["native-live-append-v1", signature, index])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}


function stableJson(value: unknown): string {
  // Postgres JSONB/SDK reload may reorder object keys without changing an entry.
  const normalized = JSON.parse(JSON.stringify(value));
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sort(record[key])]));
    }
    return item;
  };
  return JSON.stringify(sort(normalized));
}
