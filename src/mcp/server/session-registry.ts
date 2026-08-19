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

export type McpAbsoluteDeadlineScheduler = (
  delayMs: number,
  callback: () => void,
) => () => void;

export const MAX_TIMER_DELAY_MS = 2_147_483_647;

type McpAbsoluteDeadlineTimeoutHandle = {
  unref?: () => void;
};

type McpAbsoluteDeadlineSchedulerOptions = {
  setTimeout?: (
    callback: () => void,
    delayMs: number,
  ) => McpAbsoluteDeadlineTimeoutHandle;
  clearTimeout?: (handle: McpAbsoluteDeadlineTimeoutHandle) => void;
};

export function createMcpAbsoluteDeadlineScheduler(
  options: McpAbsoluteDeadlineSchedulerOptions = {},
): McpAbsoluteDeadlineScheduler {
  const setTimeoutFn = options.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimeoutFn = options.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  return (delayMs, callback) => {
    let cancelled = false;
    let completed = false;
    let remaining = Math.max(0, delayMs);
    let activeTimer: McpAbsoluteDeadlineTimeoutHandle | null = null;

    const scheduleNext = (): void => {
      if (cancelled || completed) return;
      const chunk = Math.min(remaining, MAX_TIMER_DELAY_MS);
      remaining -= chunk;
      activeTimer = setTimeoutFn(() => {
        activeTimer = null;
        if (cancelled || completed) return;
        if (remaining > 0) {
          scheduleNext();
          return;
        }
        completed = true;
        callback();
      }, chunk);
      activeTimer.unref?.();
    };

    scheduleNext();
    return () => {
      if (cancelled || completed) return;
      cancelled = true;
      if (activeTimer) {
        clearTimeoutFn(activeTimer);
        activeTimer = null;
      }
    };
  };
}

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
  expectedCloseReason?: "client_close";
  absoluteDeadlineCancel?: () => void;
};

export type McpSessionReservation = {
  readonly userId: string;
  readonly namespace: McpSessionNamespace;
  released: boolean;
  committed: boolean;
};

export type McpSessionRegistryOptions = {
  now?: () => number;
  idleTtlMs?: number;
  absoluteTtlMs?: number;
  maxPerUser?: number;
  maxTotal?: number;
  sweepMinIntervalMs?: number;
  observer?: (event: McpSessionObserverEvent) => void;
  scheduleAbsoluteDeadline?: McpAbsoluteDeadlineScheduler;
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
  private readonly scheduleAbsoluteDeadline: McpAbsoluteDeadlineScheduler;
  private lastSweepAt = Number.NEGATIVE_INFINITY;
  private readonly reservations = new Set<McpSessionReservation>();

  constructor(options: McpSessionRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.absoluteTtlMs = options.absoluteTtlMs ?? DEFAULT_ABSOLUTE_TTL_MS;
    this.maxPerUser = options.maxPerUser ?? DEFAULT_MAX_PER_USER;
    this.maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL;
    this.sweepMinIntervalMs =
      options.sweepMinIntervalMs ?? DEFAULT_SWEEP_MIN_INTERVAL_MS;
    this.observer = options.observer;
    this.scheduleAbsoluteDeadline = options.scheduleAbsoluteDeadline ?? createMcpAbsoluteDeadlineScheduler();
  }

  get size(): number {
    return this.sessions.size;
  }

  get capacitySize(): number {
    return this.sessions.size + this.reservations.size;
  }

  reserve(
    userId: string,
    namespace: McpSessionNamespace,
  ): McpSessionReservation | null {
    if (this.capacitySize >= this.maxTotal) return null;
    if (this.countUserNamespace(userId, namespace) + this.countReservedUserNamespace(userId, namespace) >= this.maxPerUser) {
      return null;
    }
    const reservation: McpSessionReservation = {
      userId,
      namespace,
      released: false,
      committed: false,
    };
    this.reservations.add(reservation);
    return reservation;
  }

  async admit(
    userId: string,
    namespace: McpSessionNamespace,
  ): Promise<McpSessionReservation | null> {
    await this.sweep();
    const reservation = this.reserve(userId, namespace);
    if (reservation) return reservation;
    await this.sweep(true);
    return this.reserve(userId, namespace);
  }

  release(reservation: McpSessionReservation): boolean {
    if (reservation.released || reservation.committed) return false;
    reservation.released = true;
    return this.reservations.delete(reservation);
  }

  commit(
    reservation: McpSessionReservation,
    input: {
      sessionId: string;
      userId: string;
      namespace: McpSessionNamespace;
      server: Closable;
      transport: object;
      inFlightCount?: number;
    },
  ): McpSessionRecord {
    if (reservation.released || reservation.committed || !this.reservations.has(reservation)) {
      throw new Error("MCP_SESSION_RESERVATION_INVALID");
    }
    if (reservation.userId !== input.userId || reservation.namespace !== input.namespace) {
      throw new Error("MCP_SESSION_RESERVATION_MISMATCH");
    }
    reservation.committed = true;
    this.reservations.delete(reservation);
    return this.insert(input);
  }

  register(input: {
    sessionId: string;
    userId: string;
    namespace: McpSessionNamespace;
    server: Closable;
    transport: object;
  }): McpSessionRecord {
    const reservation = this.reserve(input.userId, input.namespace);
    if (!reservation) throw new Error("MCP_SESSION_CAPACITY_EXCEEDED");
    try {
      return this.commit(reservation, input);
    } catch (error) {
      this.release(reservation);
      throw error;
    }
  }

  private insert(input: {
    sessionId: string;
    userId: string;
    namespace: McpSessionNamespace;
    server: Closable;
    transport: object;
    inFlightCount?: number;
  }): McpSessionRecord {
    if (this.sessions.has(input.sessionId)) {
      throw new Error("MCP_SESSION_ALREADY_REGISTERED");
    }
    const now = this.now();
    const record: McpSessionRecord = {
      ...input,
      createdAt: now,
      lastActivityAt: now,
      inFlightCount: input.inFlightCount ?? 0,
      closed: false,
    };
    this.sessions.set(record.sessionId, record);
    record.absoluteDeadlineCancel = this.scheduleAbsoluteDeadline(
      this.absoluteTtlMs,
      () => { void this.closeRecord(record, "absolute_ttl"); },
    );
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
    return this.capacitySize < this.maxTotal &&
      this.countUserNamespace(userId, namespace) + this.countReservedUserNamespace(userId, namespace) < this.maxPerUser;
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
    this.removeAndObserve(record, record.expectedCloseReason ?? "transport_close");
    return true;
  }

  expectClose(record: McpSessionRecord): void {
    if (!record.closed) record.expectedCloseReason = "client_close";
  }

  clearExpectedClose(record: McpSessionRecord): void {
    if (!record.closed) delete record.expectedCloseReason;
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
    record.absoluteDeadlineCancel?.();
    record.absoluteDeadlineCancel = undefined;
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

  private countReservedUserNamespace(userId: string, namespace: McpSessionNamespace): number {
    return [...this.reservations].filter(
      (reservation) => reservation.userId === userId && reservation.namespace === namespace && !reservation.released && !reservation.committed,
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
