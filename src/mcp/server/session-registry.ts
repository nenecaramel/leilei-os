export type McpSessionNamespace = "public" | "internal";

export type McpSessionCloseReason =
  | "client_close"
  | "transport_close"
  | "idle_ttl"
  | "absolute_ttl";

export type McpSessionObserverEvent =
  | {
      name: "mcp_session_created";
      namespace: McpSessionNamespace;
      activeSessionCount: number;
      activeNamespaceCount: number;
    }
  | {
      name: "mcp_session_closed";
      namespace: McpSessionNamespace;
      reason: McpSessionCloseReason;
      activeSessionCount: number;
      activeNamespaceCount: number;
      durationMs: number;
    }
  | {
      name: "mcp_session_capacity_rejected";
      namespace: McpSessionNamespace;
      activeSessionCount: number;
      activeNamespaceCount: number;
    };

type Closable = {
  close: () => Promise<void> | void;
};

export type McpSessionRecord = {
  sessionId: string;
  userId: string;
  namespace: McpSessionNamespace;
  server: Closable;
  transport: object;
  createdAt: number;
  lastActivityAt: number;
  inFlightCount: number;
  closed: boolean;
};

export type McpSessionRegistryOptions = {
  now?: () => number;
  idleTtlMs?: number;
  absoluteTtlMs?: number;
  maxPerUser?: number;
  maxTotal?: number;
  sweepMinIntervalMs?: number;
  observer?: (event: McpSessionObserverEvent) => void;
};

const DEFAULT_IDLE_TTL_MS = 2 * 60 * 60 * 1_000;
const DEFAULT_ABSOLUTE_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_PER_USER = 8;
const DEFAULT_MAX_TOTAL = 32;
const DEFAULT_SWEEP_MIN_INTERVAL_MS = 60_000;

export class McpSessionRegistry {
  private readonly sessions = new Map<string, McpSessionRecord>();
  private readonly now: () => number;
  private readonly idleTtlMs: number;
  private readonly absoluteTtlMs: number;
  private readonly maxPerUser: number;
  private readonly maxTotal: number;
  private readonly sweepMinIntervalMs: number;
  private readonly observer?: (event: McpSessionObserverEvent) => void;
  private lastSweepAt = Number.NEGATIVE_INFINITY;

  constructor(options: McpSessionRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.absoluteTtlMs = options.absoluteTtlMs ?? DEFAULT_ABSOLUTE_TTL_MS;
    this.maxPerUser = options.maxPerUser ?? DEFAULT_MAX_PER_USER;
    this.maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL;
    this.sweepMinIntervalMs =
      options.sweepMinIntervalMs ?? DEFAULT_SWEEP_MIN_INTERVAL_MS;
    this.observer = options.observer;
  }

  get size(): number {
    return this.sessions.size;
  }

  register(input: {
    sessionId: string;
    userId: string;
    namespace: McpSessionNamespace;
    server: Closable;
    transport: object;
  }): McpSessionRecord {
    if (this.sessions.has(input.sessionId)) {
      throw new Error("MCP_SESSION_ALREADY_REGISTERED");
    }
    const now = this.now();
    const record: McpSessionRecord = {
      ...input,
      createdAt: now,
      lastActivityAt: now,
      inFlightCount: 0,
      closed: false,
    };
    this.sessions.set(record.sessionId, record);
    this.emit({
      name: "mcp_session_created",
      namespace: record.namespace,
      activeSessionCount: this.size,
      activeNamespaceCount: this.countNamespace(record.namespace),
    });
    return record;
  }

  find(sessionId: string): McpSessionRecord | null {
    return this.sessions.get(sessionId) ?? null;
  }

  findAnyNamespace(sessionId: string): McpSessionRecord | null {
    return this.find(sessionId);
  }

  async acquire(
    sessionId: string,
    namespace: McpSessionNamespace,
    userId?: string,
  ): Promise<McpSessionRecord | null> {
    const record = this.sessions.get(sessionId);
    if (!record || record.namespace !== namespace || (userId && record.userId !== userId)) {
      return null;
    }
    const reason = this.expiryReason(record, this.now());
    if (reason === "absolute_ttl" || (reason === "idle_ttl" && record.inFlightCount === 0)) {
      await this.closeRecord(record, reason);
      return null;
    }
    record.lastActivityAt = this.now();
    record.inFlightCount += 1;
    return record;
  }

  finishRequest(record: McpSessionRecord): void {
    if (record.inFlightCount > 0) record.inFlightCount -= 1;
  }

  touch(sessionId: string): McpSessionRecord | null {
    const record = this.sessions.get(sessionId);
    if (!record || record.closed) return null;
    record.lastActivityAt = this.now();
    return record;
  }

  canCreate(userId: string, namespace: McpSessionNamespace): boolean {
    if (this.size >= this.maxTotal) return false;
    return this.countUserNamespace(userId, namespace) < this.maxPerUser;
  }

  observeCapacityRejected(namespace: McpSessionNamespace): void {
    this.emit({
      name: "mcp_session_capacity_rejected",
      namespace,
      activeSessionCount: this.size,
      activeNamespaceCount: this.countNamespace(namespace),
    });
  }

  async sweep(force = false): Promise<number> {
    const now = this.now();
    if (!force && now - this.lastSweepAt < this.sweepMinIntervalMs) return 0;
    this.lastSweepAt = now;
    const expired = [...this.sessions.values()].filter((record) => {
      const reason = this.expiryReason(record, now);
      return reason === "absolute_ttl" || (reason === "idle_ttl" && record.inFlightCount === 0);
    });
    await Promise.all(expired.map((record) => this.closeRecord(record, this.expiryReason(record, now)!)));
    return expired.length;
  }

  async close(
    sessionId: string,
    reason: McpSessionCloseReason,
  ): Promise<boolean> {
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    await this.closeRecord(record, reason);
    return true;
  }

  handleTransportClose(transport: object): boolean {
    const record = [...this.sessions.values()].find((candidate) => candidate.transport === transport);
    if (!record || record.closed) return false;
    this.removeAndObserve(record, "transport_close");
    return true;
  }

  private expiryReason(
    record: McpSessionRecord,
    now: number,
  ): "idle_ttl" | "absolute_ttl" | null {
    if (now - record.createdAt >= this.absoluteTtlMs) return "absolute_ttl";
    if (now - record.lastActivityAt >= this.idleTtlMs) return "idle_ttl";
    return null;
  }

  private async closeRecord(
    record: McpSessionRecord,
    reason: McpSessionCloseReason,
  ): Promise<void> {
    if (record.closed) return;
    this.removeAndObserve(record, reason);
    try {
      await record.server.close();
    } catch {
      // The session is removed even when provider cleanup fails. The caller
      // must never be able to resurrect an expired session.
    }
  }

  private removeAndObserve(
    record: McpSessionRecord,
    reason: McpSessionCloseReason,
  ): void {
    if (record.closed) return;
    record.closed = true;
    this.sessions.delete(record.sessionId);
    this.emit({
      name: "mcp_session_closed",
      namespace: record.namespace,
      reason,
      activeSessionCount: this.size,
      activeNamespaceCount: this.countNamespace(record.namespace),
      durationMs: Math.max(0, this.now() - record.createdAt),
    });
  }

  private countNamespace(namespace: McpSessionNamespace): number {
    return [...this.sessions.values()].filter((record) => record.namespace === namespace).length;
  }

  private countUserNamespace(userId: string, namespace: McpSessionNamespace): number {
    return [...this.sessions.values()].filter(
      (record) => record.userId === userId && record.namespace === namespace,
    ).length;
  }

  private emit(event: McpSessionObserverEvent): void {
    try {
      this.observer?.(event);
    } catch {
      // Observability must never affect session handling.
    }
  }
}
