import type {
  TopicResurfaceCrossDeviceCoordinator,
  TopicResurfaceCrossDeviceResult,
} from "./topic-resurface-cross-device-coordinator.js";

export type TopicResurfaceCrossDeviceOpportunityPolicy = {
  candidateLimit: number;
};

export type TopicResurfaceCrossDeviceOpportunityResult = {
  outcome: "attempted";
  attemptedAt: string;
  result: TopicResurfaceCrossDeviceResult;
};

type Coordinator = Pick<TopicResurfaceCrossDeviceCoordinator, "start">;

/**
 * Due-opportunity producer for the durable cross-device Topic workflow.
 *
 * Cadence is owned once, by Mac Companion. This adapter only coalesces
 * concurrent offers and stages backend-owned durable work; it owns no clock
 * history or duplicate interval gate.
 */
export class TopicResurfaceCrossDeviceOpportunity {
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

    const key = `${userId}:\u0000:${this.subjectId}`;
    const existingAttempt = this.inFlight.get(key);
    if (existingAttempt) {
      return existingAttempt;
    }

    const attempt = this.attempt({
      userId,
      at: normalizeIso(this.now()),
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
    userId: string;
    at: string;
  }): Promise<TopicResurfaceCrossDeviceOpportunityResult> {
    const result = await this.coordinator.start({
      userId: input.userId,
      subjectId: this.subjectId,
      now: input.at,
      candidateLimit: this.policy.candidateLimit,
    });

    return {
      outcome: "attempted",
      attemptedAt: input.at,
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
