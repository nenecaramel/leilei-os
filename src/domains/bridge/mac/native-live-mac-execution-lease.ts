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
  constructor(private readonly input: { renew(): Promise<boolean>; onRevoked(): Promise<void>; scheduler?: Scheduler }) {
    this.clock = input.scheduler ?? scheduler;
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
  }
  private async refresh(epoch: number, initial = false): Promise<void> {
    if (this.stopped || this.epoch !== epoch) return;
    this.timer = null;
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
}
