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
    { batchId: string; sessionId: string }
  >();

  constructor(
    baseUrl: string,
    private readonly token: string,
    readonly workspaceId: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    if (!this.baseUrl) {
      throw new Error("Native Live session store base URL is required.");
    }
    if (!token.trim()) {
      throw new Error("Native Live session store token is required.");
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        workspaceId,
      )
    ) {
      throw new Error("Native Live session store Workspace id must be a UUID.");
    }
  }

  async append(
    key: NativeLiveMacSessionStoreKey,
    entries: NativeLiveMacSessionStoreEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const remoteKey = this.remoteKey(key);
    const signature = appendSignature(remoteKey, entries);
    const pending = this.retryAppendBatches.get(signature);
    const appendBatchId = pending?.batchId ?? randomUUID();
    try {
      await this.post("/append", {
        key: remoteKey,
        append_batch_id: appendBatchId,
        entries,
      });
      if (
        this.retryAppendBatches.get(signature)?.batchId
        === appendBatchId
      ) {
        this.retryAppendBatches.delete(signature);
      }
    } catch (error) {
      this.retryAppendBatches.set(signature, {
        batchId: appendBatchId,
        sessionId: remoteKey.session_id,
      });
      throw error;
    }
  }

  discardPendingAppends(sessionId: string): void {
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
        workspace_id: this.workspaceId,
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
        workspace_id: this.workspaceId,
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
        workspace_id: this.workspaceId,
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

  private async markStatus(
    sessionId: string,
    state: "complete" | "incomplete",
  ): Promise<void> {
    const data = readRecord(
      await this.post(
        state === "complete" ? "/mark-complete" : "/mark-incomplete",
        {
          workspace_id: this.workspaceId,
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
      workspace_id: this.workspaceId,
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

function appendSignature(
  key: { workspace_id: string; session_id: string; subpath?: string },
  entries: NativeLiveMacSessionStoreEntry[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ key, entries }))
    .digest("hex");
}
