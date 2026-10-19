import {
  chooseDueWakeFireSlot,
  nextSilenceWakeDeadline,
  type NativeLiveSilenceWakeIgnoredReason,
  type NativeLiveSilenceWakeSchedule,
  type NativeLiveWakeFireSlot,
} from "../turn/native-live-silence-wake.js";

export interface NativeLiveMacSilenceWakeClient {
  readSilenceWakeSchedule(): Promise<
    NativeLiveSilenceWakeSchedule | null
  >;
  fireSilenceWake(input: {
    epochId: string;
    slot: NativeLiveWakeFireSlot;
  }): Promise<{
    outcome: "queued" | "ignored";
    schedule: NativeLiveSilenceWakeSchedule | null;
    reason?: NativeLiveSilenceWakeIgnoredReason;
  }>;
}

// When the server ignores a fire but the local clock still sees it as due
// (clock skew, a race), back off instead of re-firing in a tight loop.
const IGNORED_STILL_DUE_BACKOFF_MS = 60_000;

export class NativeLiveMacSilenceWakeScheduler {
  private schedule: NativeLiveSilenceWakeSchedule | null = null;
  private retryNotBefore = 0;
  private firePromise: Promise<{
    outcome: "queued" | "ignored" | "not_due";
    slot?: NativeLiveWakeFireSlot;
    reason?: NativeLiveSilenceWakeIgnoredReason;
  }> | null = null;

  constructor(
    private readonly client: NativeLiveMacSilenceWakeClient,
    private readonly now: () => number = () => Date.now(),
    private readonly control?: {isEnabled(): boolean; watch(onChange:()=>void): ()=>void},
  ) {}

  async refresh(): Promise<NativeLiveSilenceWakeSchedule | null> {
    this.schedule = await this.client.readSilenceWakeSchedule();
    return this.schedule;
  }

  watchChanges(onChange:()=>void): ()=>void {
    return this.control?.watch(onChange) ?? (()=>{});
  }

  nextDeadlineAt(): number | null {
    if(this.control && !this.control.isEnabled())return null;
    const deadline = nextSilenceWakeDeadline(this.schedule, this.now());
    return deadline === null ? null : Math.max(deadline, this.retryNotBefore);
  }

  fireDue(): Promise<{
    outcome: "queued" | "ignored" | "not_due";
    slot?: NativeLiveWakeFireSlot;
    reason?: NativeLiveSilenceWakeIgnoredReason;
  }> {
    if (this.firePromise) return this.firePromise;
    const promise = this.fireDueOnce().finally(() => {
      if (this.firePromise === promise) this.firePromise = null;
    });
    this.firePromise = promise;
    return promise;
  }

  private async fireDueOnce(): Promise<{
    outcome: "queued" | "ignored" | "not_due";
    slot?: NativeLiveWakeFireSlot;
    reason?: NativeLiveSilenceWakeIgnoredReason;
  }> {
    if(this.control && !this.control.isEnabled())return {outcome:"not_due"};
    if (this.now() < this.retryNotBefore) return { outcome: "not_due" };
    const slot = chooseDueWakeFireSlot(this.schedule, this.now());
    if (!slot || !this.schedule) return { outcome: "not_due" };

    const epochId = this.schedule.epochId;
    const result = await this.client.fireSilenceWake({ epochId, slot });
    this.schedule = result.schedule;
    this.retryNotBefore =
      result.outcome === "ignored"
      && chooseDueWakeFireSlot(result.schedule, this.now()) !== null
        ? this.now() + IGNORED_STILL_DUE_BACKOFF_MS
        : 0;
    return {
      outcome: result.outcome,
      slot,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  }
}
