export type NativeLiveMacCompanionOpportunityReason =
  | "startup"
  | "dirty"
  | "due";

export interface NativeLiveMacCompanionBackgroundClient {
  offerCompanionBackgroundOpportunity(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
    reason: NativeLiveMacCompanionOpportunityReason;
  }): Promise<unknown>;
}

export type NativeLiveMacCompanionSchedulerResult =
  | {
      outcome: "not_due";
      nextEligibleAt: string;
    }
  | {
      outcome: "offered";
      reason: NativeLiveMacCompanionOpportunityReason;
      nextEligibleAt: string;
    }
  | {
      outcome: "failed";
      reason: NativeLiveMacCompanionOpportunityReason;
    };

/**
 * Timer-free local scheduler for Mac Companion background life.
 *
 * The daemon only calls offer() after foreground, semantic and already-durable
 * background model work are empty. The first idle opportunity performs bounded
 * startup catch-up, successful foreground completion marks the scheduler dirty,
 * and otherwise cadence is driven by the local clock. Concurrent offers
 * coalesce into one remote authority request.
 */
export class NativeLiveMacCompanionScheduler {
  private startupPending = true;
  private dirtyVersion = 0;
  private clearedDirtyVersion = 0;
  private nextEligibleAtMs = 0;
  private inFlight: Promise<NativeLiveMacCompanionSchedulerResult> | null =
    null;

  constructor(
    private readonly client: NativeLiveMacCompanionBackgroundClient,
    private readonly listenerInstanceId: string,
    private readonly intervalMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly onOpportunityResult:
      | ((
          result: Exclude<
            NativeLiveMacCompanionSchedulerResult,
            { outcome: "not_due" }
          >,
        ) => void | Promise<void>)
      | null = null,
  ) {
    if (!listenerInstanceId.trim()) {
      throw new Error(
        "Companion scheduler listener instance id must not be blank.",
      );
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(
        "Companion scheduler intervalMs must be positive and finite.",
      );
    }
  }

  markDirty(): void {
    this.dirtyVersion += 1;
  }

  offer(): Promise<NativeLiveMacCompanionSchedulerResult> {
    if (this.inFlight) return this.inFlight;

    const nowMs = normalizeNow(this.now());
    const reason = this.reasonAt(nowMs);
    if (!reason) {
      return Promise.resolve({
        outcome: "not_due",
        nextEligibleAt: new Date(this.nextEligibleAtMs).toISOString(),
      });
    }

    const dirtyVersionAtStart = this.dirtyVersion;
    let run!: Promise<NativeLiveMacCompanionSchedulerResult>;
    run = this.client
      .offerCompanionBackgroundOpportunity({
        listenerInstanceId: this.listenerInstanceId,
        dispatchTarget: "claude_code",
        reason,
      })
      .then(async () => {
        const completedAt = normalizeNow(this.now());
        this.startupPending = false;
        if (this.dirtyVersion === dirtyVersionAtStart) {
          this.clearedDirtyVersion = this.dirtyVersion;
        }
        this.nextEligibleAtMs = completedAt + this.intervalMs;
        const result = {
          outcome: "offered" as const,
          reason,
          nextEligibleAt:
            new Date(this.nextEligibleAtMs).toISOString(),
        };
        await this.observeOpportunityResult(result);
        return result;
      })
      .catch(async () => {
        const result = {
          outcome: "failed" as const,
          reason,
        };
        await this.observeOpportunityResult(result);
        return result;
      })
      .finally(() => {
        if (this.inFlight === run) this.inFlight = null;
      });

    this.inFlight = run;
    return run;
  }

  private async observeOpportunityResult(
    result: Exclude<
      NativeLiveMacCompanionSchedulerResult,
      { outcome: "not_due" }
    >,
  ): Promise<void> {
    try {
      await this.onOpportunityResult?.(result);
    } catch {
      // Acceptance observability must never change scheduler semantics.
    }
  }

  private reasonAt(
    nowMs: number,
  ): NativeLiveMacCompanionOpportunityReason | null {
    if (this.startupPending) return "startup";
    if (this.dirtyVersion !== this.clearedDirtyVersion) {
      return "dirty";
    }
    if (nowMs >= this.nextEligibleAtMs) return "due";
    return null;
  }
}

function normalizeNow(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      "Companion scheduler clock must return finite epoch milliseconds.",
    );
  }
  return value;
}
