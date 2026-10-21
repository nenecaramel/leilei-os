/** Elapsed validity clock, with wall time accounting for host sleep. */
export function createConservativeLeaseClock(input = {
  monotonicNow: () => performance.now(),
  wallNow: () => Date.now(),
}): () => number {
  const monotonicOrigin = input.monotonicNow();
  const wallOrigin = input.wallNow();
  let elapsed = 0;
  return () => {
    elapsed = Math.max(elapsed, input.monotonicNow() - monotonicOrigin, input.wallNow() - wallOrigin);
    return elapsed;
  };
}

type Scheduler = { schedule(work: () => Promise<void>, delayMs: number): unknown; cancel(token: unknown): void };
const scheduler: Scheduler = {
  schedule(work, delay) { const timer = setTimeout(() => { void work(); }, delay); timer.unref(); return timer; },
  cancel(token) { clearTimeout(token as ReturnType<typeof setTimeout>); },
};

/** One executing reservation only. Never reacquire an expired listener/turn. */
export class NativeLiveMacExecutionLease {
  private epoch = 0;
  private stopped = false;
  private started = false;
  private timer: unknown = null;
  private readonly clock: Scheduler;
  private expiryTimer: unknown = null;
  private validUntil: number | null = null;
  private readonly now: () => number;
  constructor(private readonly input: { renew(): Promise<boolean>; onRevoked(): Promise<void>; scheduler?: Scheduler; now?: () => number; transientRetry?: { validForMs: number; retryMs: number } }) {
    this.clock = input.scheduler ?? scheduler;
    this.now = input.now ?? createConservativeLeaseClock();
  }
  async start(): Promise<void> {
    if (this.started || this.stopped) throw new Error("Execution lease cannot be restarted.");
    this.started = true;
    await this.refresh(++this.epoch, true);
  }
  stop(): void {
    this.stopped = true; this.epoch++;
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.timer = null;
    if (this.expiryTimer !== null) this.clock.cancel(this.expiryTimer);
    this.expiryTimer = null;
  }
  private async refresh(epoch: number, initial = false): Promise<void> {
    if (this.stopped || this.epoch !== epoch) return;
    this.timer = null;
    if (this.input.transientRetry) return this.refreshWithDeadline(epoch, initial);
    let renewed = false;
    try { renewed = await this.input.renew() === true; } catch { /* Deny on uncertainty. */ }
    if (this.stopped || this.epoch !== epoch) return;
    if (!renewed) {
      this.stop();
      try { await this.input.onRevoked(); } catch { /* Failed close remains registry-owned. */ }
      if (initial) throw new Error("Execution lease was not renewed.");
      return;
    }
    this.timer = this.clock.schedule(() => this.refresh(epoch), 20_000);
  }

  private async revoke(initial = false): Promise<void> {
    this.stop();
    try { await this.input.onRevoked(); } catch { /* Failed close remains registry-owned. */ }
    if (initial) throw new Error("Execution lease was not renewed.");
  }
  private async refreshWithDeadline(epoch: number, initial: boolean): Promise<void> {
    const policy = this.input.transientRetry!;
    const requestedAt = this.now();
    // A delayed callback must never reacquire an already expired session lease.
    if (this.validUntil !== null && requestedAt >= this.validUntil) return this.revoke(initial);
    let renewed = false;
    let uncertain = false;
    try { renewed = await this.input.renew() === true; } catch { uncertain = true; }
    if (this.stopped || this.epoch !== epoch) return;
    const settledAt = this.now();
    // The independent expiry timer also guards a renewal that never settles.
    if (this.validUntil !== null && settledAt >= this.validUntil) return this.revoke(initial);
    if (!renewed) {
      if (!uncertain || initial || this.validUntil === null) return this.revoke(initial);
      if (settledAt + policy.retryMs < this.validUntil) {
        this.timer = this.clock.schedule(() => this.refresh(epoch), policy.retryMs);
      }
      return;
    }
    // The server can grant the lease as early as request start, not response receipt.
    const deadline = requestedAt + policy.validForMs;
    if (settledAt >= deadline) return this.revoke(initial);
    this.validUntil = deadline;
    if (this.expiryTimer !== null) this.clock.cancel(this.expiryTimer);
    this.expiryTimer = this.clock.schedule(async () => {
      if (this.stopped || this.epoch !== epoch || this.validUntil !== deadline) return;
      await this.revoke();
    }, deadline - settledAt);
    if (settledAt + 20_000 < deadline) {
      this.timer = this.clock.schedule(() => this.refresh(epoch), 20_000);
    }
  }
}
