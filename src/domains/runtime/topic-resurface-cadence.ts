import type {
  TopicResurfaceBackgroundScheduleInput,
} from "./topic-resurface-background-trigger.js";

export type TopicResurfaceCadencePolicy = {
  minIntervalMs: number;
};

export type TopicResurfaceCadenceResult =
  | {
      outcome: "scheduled";
      scheduledAt: string;
      nextEligibleAt: string;
    }
  | {
      outcome: "not_due";
      lastScheduledAt: string;
      nextEligibleAt: string;
    };

export interface TopicResurfaceScheduleSink {
  schedule(input: TopicResurfaceBackgroundScheduleInput): void;
}

/**
 * Pure in-process cadence gate for Topic-resurface background opportunities.
 *
 * It owns no timer and persists no operational record. External runtime events
 * may offer opportunities as often as they want; only this gate decides whether
 * the configured cadence is due. A process restart intentionally forgets this
 * soft operational timestamp instead of inventing permanent scheduler history.
 */
export class TopicResurfaceCadenceGate {
  private readonly lastScheduledAt = new Map<string, string>();

  constructor(
    private readonly scheduler: TopicResurfaceScheduleSink,
    private readonly policy: TopicResurfaceCadencePolicy,
  ) {
    if (
      !Number.isFinite(policy.minIntervalMs)
      || policy.minIntervalMs <= 0
    ) {
      throw new Error(
        "Topic resurface cadence minIntervalMs must be positive and finite.",
      );
    }
  }

  offer(input: {
    userId: string;
    subjectId: string;
    at: string;
  }): TopicResurfaceCadenceResult {
    const userId = input.userId.trim();
    const subjectId = input.subjectId.trim();
    if (!userId || !subjectId) {
      throw new Error(
        "Topic resurface cadence identity must not be blank.",
      );
    }
    const at = normalizeIso(input.at);
    const key = keyOf({ userId, subjectId });
    const previous = this.lastScheduledAt.get(key);

    if (previous) {
      const nextEligibleAt = new Date(
        Date.parse(previous) + this.policy.minIntervalMs,
      ).toISOString();
      if (Date.parse(at) < Date.parse(nextEligibleAt)) {
        return {
          outcome: "not_due",
          lastScheduledAt: previous,
          nextEligibleAt,
        };
      }
    }

    this.scheduler.schedule({ userId, subjectId });
    this.lastScheduledAt.set(key, at);

    return {
      outcome: "scheduled",
      scheduledAt: at,
      nextEligibleAt: new Date(
        Date.parse(at) + this.policy.minIntervalMs,
      ).toISOString(),
    };
  }
}

function keyOf(input: {
  userId: string;
  subjectId: string;
}): string {
  return `${input.userId}:\u0000:${input.subjectId}`;
}

function normalizeIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Topic resurface cadence opportunity must use an ISO timestamp.",
    );
  }
  return new Date(parsed).toISOString();
}
