import type {
  TopicResurfaceCrossDeviceCoordinator,
  TopicResurfaceCrossDeviceResult,
} from "./topic-resurface-cross-device-coordinator.js";

export type TopicResurfaceCrossDeviceOpportunityPolicy = {
  minIntervalMs: number;
  candidateLimit: number;
};

export type TopicResurfaceCrossDeviceOpportunityResult =
  | {
      outcome: "not_due";
      lastAttemptAt: string;
      nextEligibleAt: string;
    }
  | {
      outcome: "attempted";
      attemptedAt: string;
      nextEligibleAt: string;
      result: TopicResurfaceCrossDeviceResult;
    };

type Coordinator = Pick<TopicResurfaceCrossDeviceCoordinator, "start">;

/**
 * Idle-opportunity producer for the durable cross-device Topic workflow.
 *
 * This intentionally stays outside the in-process BackgroundLoopOrchestrator:
 * coordinator.start() creates backend-owned durable queue work; it does not run
 * Claude locally. The Mac daemon gives foreground Native Live work priority and
 * only reserves background-model jobs while foreground is idle.
 */
export class TopicResurfaceCrossDeviceOpportunity {
  private readonly lastAttemptAt = new Map<string, string>();
  private readonly inFlight = new Map<
    string,
    Promise<TopicResurfaceCrossDeviceOpportunityResult>
  >();

  constructor(
    private readonly coordinator: Coordinator,
    private readonly subjectId: string,
    private readonly policy: TopicResurfaceCrossDeviceOpportunityPolicy,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    if (!subjectId.trim()) {
      throw new Error("Topic resurface opportunity subject id must not be blank.");
    }
    if (
      !Number.isFinite(policy.minIntervalMs)
      || policy.minIntervalMs <= 0
    ) {
      throw new Error(
        "Topic resurface opportunity minIntervalMs must be positive and finite.",
      );
    }
    if (
      !Number.isInteger(policy.candidateLimit)
      || policy.candidateLimit <= 0
    ) {
      throw new Error(
        "Topic resurface opportunity candidateLimit must be a positive integer.",
      );
    }
  }

  async offer(input: {
    userId: string;
  }): Promise<TopicResurfaceCrossDeviceOpportunityResult> {
    const userId = input.userId.trim();
    if (!userId) {
      throw new Error("Topic resurface opportunity user id must not be blank.");
    }

    const at = normalizeIso(this.now());
    const key = `${userId}:\u0000:${this.subjectId}`;
    const previous = this.lastAttemptAt.get(key);
    if (previous) {
      const nextEligibleAt = new Date(
        Date.parse(previous) + this.policy.minIntervalMs,
      ).toISOString();
      if (Date.parse(at) < Date.parse(nextEligibleAt)) {
        return {
          outcome: "not_due",
          lastAttemptAt: previous,
          nextEligibleAt,
        };
      }
    }

    const existingAttempt = this.inFlight.get(key);
    if (existingAttempt) {
      return existingAttempt;
    }

    const attempt = this.attempt({
      key,
      userId,
      at,
    });
    this.inFlight.set(key, attempt);
    try {
      return await attempt;
    } finally {
      if (this.inFlight.get(key) === attempt) {
        this.inFlight.delete(key);
      }
    }
  }
  private async attempt(input: {
    key: string;
    userId: string;
    at: string;
  }): Promise<TopicResurfaceCrossDeviceOpportunityResult> {
    const result = await this.coordinator.start({
      userId: input.userId,
      subjectId: this.subjectId,
      now: input.at,
      candidateLimit: this.policy.candidateLimit,
    });

    // This timestamp is intentionally soft in-process operational state.
    // Infrastructure failure throws before this point and therefore does not
    // consume cadence. A valid idle/waiting attempt does consume cadence.
    this.lastAttemptAt.set(input.key, input.at);

    return {
      outcome: "attempted",
      attemptedAt: input.at,
      nextEligibleAt: new Date(
        Date.parse(input.at) + this.policy.minIntervalMs,
      ).toISOString(),
      result,
    };
  }
}

function normalizeIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Topic resurface opportunity clock must return an ISO timestamp.",
    );
  }
  return new Date(parsed).toISOString();
}
