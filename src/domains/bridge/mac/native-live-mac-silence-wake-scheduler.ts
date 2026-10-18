import {
  chooseDueSilenceWakeSlot,
  nextSilenceWakeDeadline,
  type NativeLiveSilenceWakeIgnoredReason,
  type NativeLiveSilenceWakeSchedule,
  type NativeLiveSilenceWakeSlot,
} from "../turn/native-live-silence-wake.js";

export interface NativeLiveMacSilenceWakeClient {
  readSilenceWakeSchedule(): Promise<
    NativeLiveSilenceWakeSchedule | null
  >;
  fireSilenceWake(input: {
    epochId: string;
    slot: NativeLiveSilenceWakeSlot;
  }): Promise<{
    outcome: "queued" | "ignored";
    schedule: NativeLiveSilenceWakeSchedule | null;
    reason?: NativeLiveSilenceWakeIgnoredReason;
  }>;
}

export class NativeLiveMacSilenceWakeScheduler {
  private schedule: NativeLiveSilenceWakeSchedule | null = null;
  private firePromise: Promise<{
    outcome: "queued" | "ignored" | "not_due";
    slot?: NativeLiveSilenceWakeSlot;
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
    return nextSilenceWakeDeadline(this.schedule, this.now());
  }

  fireDue(): Promise<{
    outcome: "queued" | "ignored" | "not_due";
    slot?: NativeLiveSilenceWakeSlot;
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
    slot?: NativeLiveSilenceWakeSlot;
    reason?: NativeLiveSilenceWakeIgnoredReason;
  }> {
    if(this.control && !this.control.isEnabled())return {outcome:"not_due"};
    const slot = chooseDueSilenceWakeSlot(this.schedule, this.now());
    if (!slot || !this.schedule) return { outcome: "not_due" };

    const epochId = this.schedule.epochId;
    const result = await this.client.fireSilenceWake({ epochId, slot });
    this.schedule = result.schedule;
    return {
      outcome: result.outcome,
      slot,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  }
}
