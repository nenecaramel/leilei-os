import { sql } from "drizzle-orm";
import postgres from "postgres";
import type { createDatabase } from "../../database/client.js";

type Database = ReturnType<typeof createDatabase>["db"];

const WORK_WAKE_CHANNEL = "leileios_native_live_work_ready";
const TRANSIENT_WAKE_VERSION_TTL_MS = 120_000;

export type NativeLiveWorkKind =
  | "semantic"
  | "foreground"
  | "background_model"
  | "runtime_control"
  | "runtime_interaction"
  | "turn_terminal";

type NativeLiveWorkWakeInput =
  | {
      userId: string;
      kind: "semantic" | "foreground" | "background_model";
    }
  | {
      userId: string;
      kind: "runtime_control";
      reservationId: string;
    }
  | {
      userId: string;
      kind: "runtime_interaction";
      interactionId: string;
    }
  | {
      userId: string;
      kind: "turn_terminal";
      prepareId: string;
    };

export type NativeLiveWorkWaitOutcome =
  | { outcome: "ready"; version: number }
  | { outcome: "timeout"; version: number };

export class DrizzleNativeLiveWorkWakePublisher {
  constructor(private readonly db: Database) {}

  async notify(input: NativeLiveWorkWakeInput): Promise<void> {
    const payload = JSON.stringify({
      user_id: input.userId,
      kind: input.kind,
      ...(input.kind === "runtime_control"
        ? { reservation_id: input.reservationId }
        : {}),
      ...(input.kind === "runtime_interaction"
        ? { interaction_id: input.interactionId }
        : {}),
      ...(input.kind === "turn_terminal"
        ? { prepare_id: input.prepareId }
        : {}),
    });
    try {
      await this.db.execute(sql`
        SELECT pg_notify(${WORK_WAKE_CHANNEL}, ${payload})
      `);
    } catch {
      // Wake-up is advisory. Durable state remains authoritative and
      // wait-side reads recover missed notifications.
    }
  }
}

export class DrizzleNativeLiveWorkAvailability {
  constructor(private readonly db: Database) {}

  async hasWork(input: { userId: string }): Promise<boolean> {
    const rows = await this.db.execute<{ ready: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM native_live_semantic_scoring_requests AS semantic
        INNER JOIN native_live_turn_preparations AS preparation
          ON preparation.id = semantic.prepare_id
         AND preparation.user_id = semantic.user_id
        WHERE semantic.user_id = ${input.userId}::uuid
          AND preparation.status = 'prepared'
          AND preparation.mind_prepared = false
          AND (
            semantic.status = 'pending'
            OR (
              semantic.status = 'reserved'
              AND semantic.reservation_expires_at <= now()
            )
          )

        UNION ALL

        SELECT 1
        FROM runtime_mind_semantic_grouping_requests AS grouping
        WHERE grouping.user_id = ${input.userId}::uuid
          AND (
            grouping.status = 'pending'
            OR (
              grouping.status = 'reserved'
              AND grouping.reservation_expires_at <= now()
            )
          )

        UNION ALL

        SELECT 1
        FROM native_live_turn_preparations AS preparation
        WHERE preparation.user_id = ${input.userId}::uuid
          AND preparation.status = 'prepared'
          AND preparation.mind_prepared = true
          AND (
            preparation.dispatch_status = 'pending'
            OR (
              preparation.dispatch_status = 'reserved'
              AND preparation.reservation_expires_at <= now()
              AND preparation.execution_started_at IS NULL
            )
          )

        UNION ALL

        SELECT 1
        FROM native_live_provider_session_cleanups AS cleanup
        WHERE cleanup.user_id = ${input.userId}::uuid
          AND (
            cleanup.status = 'pending'
            OR (
              cleanup.status = 'reserved'
              AND cleanup.reservation_expires_at <= now()
            )
          )

        UNION ALL

        SELECT 1
        FROM native_live_background_model_jobs AS job
        WHERE job.user_id = ${input.userId}::uuid
          AND (
            job.status = 'pending'
            OR (
              job.status = 'reserved'
              AND job.reservation_expires_at <= now()
            )
            OR (
              job.status IN ('completed', 'failed')
              AND job.consumed_at IS NULL
            )
          )
      ) AS ready
    `);
    return rows[0]?.ready === true;
  }
}

type Waiter = {
  resolve: (outcome: NativeLiveWorkWaitOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  abortCleanup: (() => void) | null;
};

type NativeLiveWakePostgresClient = {
  listen(
    channel: string,
    onnotify: (payload: string) => void,
  ): unknown;
  end(options?: { timeout?: number }): unknown;
};

export type NativeLiveWorkWakeBrokerOptions = {
  createClient?: (
    databaseUrl: string,
  ) => NativeLiveWakePostgresClient;
  idleReleaseMs?: number;
};

const DEFAULT_WORK_WAKE_IDLE_RELEASE_MS = 2_000;

export class NativeLiveWorkWakeBroker {
  private readonly databaseUrl: string;
  private readonly createClient: (
    databaseUrl: string,
  ) => NativeLiveWakePostgresClient;
  private readonly idleReleaseMs: number;
  private client: NativeLiveWakePostgresClient | null = null;
  private readonly versions = new Map<string, number>();
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly versionExpiryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private idleReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private listenerLeaseCount = 0;
  private closed = false;

  constructor(
    databaseUrl: string,
    options: NativeLiveWorkWakeBrokerOptions = {},
  ) {
    this.databaseUrl = databaseUrl;
    this.idleReleaseMs =
      options.idleReleaseMs ?? DEFAULT_WORK_WAKE_IDLE_RELEASE_MS;
    this.createClient =
      options.createClient
      ?? ((url) =>
        postgres(url, {
          max: 1,
          prepare: false,
          ssl: "require",
          connect_timeout: 3,
          idle_timeout: 0,
        }));
  }

  async start(): Promise<void> {
    if (this.closed) {
      throw new Error("Native live work wake broker is closed.");
    }

    this.cancelIdleRelease();
    this.listenerLeaseCount += 1;
    try {
      await this.ensureStarted();
    } catch (error) {
      this.listenerLeaseCount = Math.max(
        0,
        this.listenerLeaseCount - 1,
      );
      this.scheduleIdleRelease();
      throw error;
    }
  }

  async release(): Promise<void> {
    if (this.listenerLeaseCount > 0) {
      this.listenerLeaseCount -= 1;
    }
    if (this.closed) return;
    this.scheduleIdleRelease();
  }

  version(userId: string): number {
    return this.versionForKey(userWakeKey(userId));
  }

  controlVersion(
    userId: string,
    reservationId: string,
  ): number {
    return this.versionForKey(
      controlWakeKey(userId, reservationId),
    );
  }

  waitForChange(input: {
    userId: string;
    afterVersion: number;
    timeoutMs: number;
    signal?: AbortSignal | null;
  }): Promise<NativeLiveWorkWaitOutcome> {
    return this.waitForKey({
      key: userWakeKey(input.userId),
      afterVersion: input.afterVersion,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });
  }

  waitForControlChange(input: {
    userId: string;
    reservationId: string;
    afterVersion: number;
    timeoutMs: number;
    signal?: AbortSignal | null;
  }): Promise<NativeLiveWorkWaitOutcome> {
    return this.waitForKey({
      key: controlWakeKey(
        input.userId,
        input.reservationId,
      ),
      afterVersion: input.afterVersion,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });
  }

  interactionVersion(
    userId: string,
    interactionId: string,
  ): number {
    return this.versionForKey(
      interactionWakeKey(userId, interactionId),
    );
  }

  waitForInteractionChange(input: {
    userId: string;
    interactionId: string;
    afterVersion: number;
    timeoutMs: number;
    signal?: AbortSignal | null;
  }): Promise<NativeLiveWorkWaitOutcome> {
    return this.waitForKey({
      key: interactionWakeKey(
        input.userId,
        input.interactionId,
      ),
      afterVersion: input.afterVersion,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });
  }

  turnVersion(
    userId: string,
    prepareId: string,
  ): number {
    return this.versionForKey(
      turnWakeKey(userId, prepareId),
    );
  }

  waitForTurnChange(input: {
    userId: string;
    prepareId: string;
    afterVersion: number;
    timeoutMs: number;
    signal?: AbortSignal | null;
  }): Promise<NativeLiveWorkWaitOutcome> {
    return this.waitForKey({
      key: turnWakeKey(
        input.userId,
        input.prepareId,
      ),
      afterVersion: input.afterVersion,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.listenerLeaseCount = 0;
    this.cancelIdleRelease();

    for (const [key, bucket] of this.waiters) {
      for (const waiter of [...bucket]) {
        waiter.resolve({
          outcome: "timeout",
          version: this.versionForKey(key),
        });
      }
    }
    this.waiters.clear();

    for (const timer of this.versionExpiryTimers.values()) {
      clearTimeout(timer);
    }
    this.versionExpiryTimers.clear();
    this.versions.clear();

    await this.startPromise?.catch(() => undefined);
    await this.stopListener();
  }

  private async ensureStarted(): Promise<void> {
    if (this.closed) {
      throw new Error("Native live work wake broker is closed.");
    }

    if (this.stopPromise) {
      await this.stopPromise;
    }
    if (this.closed) {
      throw new Error("Native live work wake broker is closed.");
    }
    if (this.startPromise) {
      await this.startPromise;
      return;
    }
    if (this.client) return;

    const client = this.createClient(this.databaseUrl);
    this.client = client;

    const startPromise = Promise.resolve(
      client.listen(
        WORK_WAKE_CHANNEL,
        (payload) => this.handleNotification(payload),
      ),
    )
      .then(() => undefined)
      .catch(async (error) => {
        if (this.client === client) {
          this.client = null;
        }
        try {
          await Promise.resolve(client.end({ timeout: 5 }));
        } catch {
          // Preserve the original LISTEN failure.
        }
        throw error;
      })
      .finally(() => {
        if (this.startPromise === startPromise) {
          this.startPromise = null;
        }
      });
    this.startPromise = startPromise;
    await startPromise;
  }

  private async stopListener(): Promise<void> {
    if (this.stopPromise) {
      await this.stopPromise;
      return;
    }

    const client = this.client;
    if (!client) return;

    this.client = null;
    const stopPromise = Promise.resolve()
      .then(() => client.end({ timeout: 5 }))
      .then(() => undefined)
      .finally(() => {
        if (this.stopPromise === stopPromise) {
          this.stopPromise = null;
        }
      });
    this.stopPromise = stopPromise;
    await stopPromise;
  }

  private scheduleIdleRelease(): void {
    if (
      this.closed
      || this.listenerLeaseCount > 0
      || this.waiters.size > 0
      || !this.client
      || this.idleReleaseTimer
    ) {
      return;
    }

    const timer = setTimeout(() => {
      if (this.idleReleaseTimer === timer) {
        this.idleReleaseTimer = null;
      }
      if (
        this.closed
        || this.listenerLeaseCount > 0
        || this.waiters.size > 0
      ) {
        return;
      }
      void this.stopListener().catch(() => undefined);
    }, this.idleReleaseMs);
    timer.unref?.();
    this.idleReleaseTimer = timer;
  }

  private cancelIdleRelease(): void {
    if (!this.idleReleaseTimer) return;
    clearTimeout(this.idleReleaseTimer);
    this.idleReleaseTimer = null;
  }

  private async waitForKey(input: {
    key: string;
    afterVersion: number;
    timeoutMs: number;
    signal?: AbortSignal | null;
  }): Promise<NativeLiveWorkWaitOutcome> {
    this.cancelIdleRelease();
    await this.ensureStarted();

    const current = this.versionForKey(input.key);
    if (current !== input.afterVersion) {
      this.scheduleIdleRelease();
      return { outcome: "ready", version: current };
    }
    if (input.signal?.aborted) {
      this.scheduleIdleRelease();
      return { outcome: "timeout", version: current };
    }

    return new Promise((resolve) => {
      const finish = (outcome: NativeLiveWorkWaitOutcome) => {
        const bucket = this.waiters.get(input.key);
        if (bucket) {
          bucket.delete(waiter);
          if (bucket.size === 0) this.waiters.delete(input.key);
        }
        clearTimeout(waiter.timer);
        waiter.abortCleanup?.();
        this.scheduleIdleRelease();
        resolve(outcome);
      };

      const waiter: Waiter = {
        resolve: finish,
        timer: setTimeout(() => {
          finish({
            outcome: "timeout",
            version: this.versionForKey(input.key),
          });
        }, input.timeoutMs),
        abortCleanup: null,
      };

      if (input.signal) {
        const onAbort = () => {
          finish({
            outcome: "timeout",
            version: this.versionForKey(input.key),
          });
        };
        input.signal.addEventListener("abort", onAbort, { once: true });
        waiter.abortCleanup = () =>
          input.signal?.removeEventListener("abort", onAbort);
      }

      const bucket =
        this.waiters.get(input.key) ?? new Set<Waiter>();
      bucket.add(waiter);
      this.waiters.set(input.key, bucket);

      const latest = this.versionForKey(input.key);
      if (latest !== input.afterVersion) {
        finish({ outcome: "ready", version: latest });
      }
    });
  }

  private versionForKey(key: string): number {
    return this.versions.get(key) ?? 0;
  }

  private signalKey(key: string): void {
    const version = this.versionForKey(key) + 1;
    this.versions.set(key, version);
    this.scheduleTransientVersionExpiry(key);

    const bucket = this.waiters.get(key);
    if (!bucket) return;
    for (const waiter of [...bucket]) {
      waiter.resolve({ outcome: "ready", version });
    }
  }

  private scheduleTransientVersionExpiry(key: string): void {
    if (!isTransientWakeKey(key)) return;

    const existing = this.versionExpiryTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.versionExpiryTimers.delete(key);
      if (!this.waiters.has(key)) {
        this.versions.delete(key);
      }
    }, TRANSIENT_WAKE_VERSION_TTL_MS);
    timer.unref?.();
    this.versionExpiryTimers.set(key, timer);
  }

  private handleNotification(payload: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }
    const record = parsed as Record<string, unknown>;
    const userId = record.user_id;
    const kind = record.kind;
    if (typeof userId !== "string" || !userId.trim()) return;

    if (kind === "runtime_control") {
      const reservationId = record.reservation_id;
      if (
        typeof reservationId !== "string"
        || !reservationId.trim()
      ) {
        return;
      }
      this.signalKey(
        controlWakeKey(userId, reservationId),
      );
      return;
    }

    if (kind === "runtime_interaction") {
      const interactionId = record.interaction_id;
      if (
        typeof interactionId !== "string"
        || !interactionId.trim()
      ) {
        return;
      }
      this.signalKey(
        interactionWakeKey(userId, interactionId),
      );
      return;
    }

    if (kind === "turn_terminal") {
      const prepareId = record.prepare_id;
      if (
        typeof prepareId !== "string"
        || !prepareId.trim()
      ) {
        return;
      }
      this.signalKey(
        turnWakeKey(userId, prepareId),
      );
      return;
    }

    if (
      kind === "semantic"
      || kind === "foreground"
      || kind === "background_model"
    ) {
      this.signalKey(userWakeKey(userId));
    }
  }
}

export class NativeLiveWorkWaitService {
  constructor(
    private readonly availability: DrizzleNativeLiveWorkAvailability,
    private readonly broker: NativeLiveWorkWakeBroker,
  ) {}

  async wait(input: {
    userId: string;
    timeoutMs: number;
    signal?: AbortSignal | null;
  }): Promise<NativeLiveWorkWaitOutcome> {
    await this.broker.start();
    try {
      const version = this.broker.version(input.userId);

      if (await this.availability.hasWork({ userId: input.userId })) {
        return { outcome: "ready", version };
      }

      return await this.broker.waitForChange({
        userId: input.userId,
        afterVersion: version,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      });
    } finally {
      await this.broker.release();
    }
  }
}

function userWakeKey(userId: string): string {
  return `user:${userId}`;
}

function controlWakeKey(
  userId: string,
  reservationId: string,
): string {
  return `control:${userId}:${reservationId}`;
}

function interactionWakeKey(
  userId: string,
  interactionId: string,
): string {
  return `interaction:${userId}:${interactionId}`;
}

function turnWakeKey(
  userId: string,
  prepareId: string,
): string {
  return `turn:${userId}:${prepareId}`;
}

function isTransientWakeKey(key: string): boolean {
  return (
    key.startsWith("control:")
    || key.startsWith("interaction:")
    || key.startsWith("turn:")
  );
}
