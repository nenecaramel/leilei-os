import {
  TopicResurfaceCadenceGate,
  type TopicResurfaceCadencePolicy,
  type TopicResurfaceCadenceResult,
} from "./topic-resurface-cadence.js";
import type {
  TopicResurfaceBackgroundScheduleInput,
} from "./topic-resurface-background-trigger.js";

export interface TopicResurfaceIdleBackground {
  schedule(input: TopicResurfaceBackgroundScheduleInput): void;
  drain(): Promise<void>;
}

export type TopicResurfaceIdleIdentity = {
  userId: string;
  subjectId: string;
};

/**
 * Binds a pure daemon-idle opportunity to one explicitly configured subject.
 *
 * The cadence gate remains timer-free. When a run is due, this adapter waits
 * for the background trigger to drain before releasing the daemon idle cycle,
 * keeping foreground Native Live execution and background Claude transforms
 * serialized on the same local Claude Code runtime.
 */
export class TopicResurfaceIdleOpportunity {
  private readonly identity: TopicResurfaceIdleIdentity;
  private readonly cadence: TopicResurfaceCadenceGate;

  constructor(
    private readonly background: TopicResurfaceIdleBackground,
    identity: TopicResurfaceIdleIdentity,
    policy: TopicResurfaceCadencePolicy,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    const userId = identity.userId.trim();
    const subjectId = identity.subjectId.trim();
    if (!userId || !subjectId) {
      throw new Error(
        "Topic resurface idle identity must not be blank.",
      );
    }
    this.identity = { userId, subjectId };
    this.cadence = new TopicResurfaceCadenceGate(
      background,
      policy,
    );
  }

  async offer(): Promise<TopicResurfaceCadenceResult> {
    const decision = this.cadence.offer({
      ...this.identity,
      at: this.now(),
    });
    if (decision.outcome === "scheduled") {
      await this.background.drain();
    }
    return decision;
  }
}
