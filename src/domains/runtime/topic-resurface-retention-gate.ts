import type {
  TopicResurfaceCandidate,
} from "./topic-resurface-candidates.js";
import type {
  TopicResurfaceInternalLoopResult,
  TopicResurfaceInternalLoopService,
} from "./topic-resurface-internal-loop.js";

export type TopicResurfaceRetentionDecision =
  | { decision: "discard" }
  | { decision: "retain_as_thought_seed" };

export interface TopicResurfaceRetentionEvaluator {
  evaluate(input: {
    evaluatedAt: string;
    candidate: TopicResurfaceCandidate;
    reflection: string;
  }): Promise<TopicResurfaceRetentionDecision>;
}

export type TopicResurfaceRetentionResult =
  | Exclude<TopicResurfaceInternalLoopResult, { outcome: "reflection" }>
  | {
      outcome: "retention_failed";
      evaluatedAt: string;
      candidateCount: number;
      candidate: TopicResurfaceCandidate;
      reflection: string;
    }
  | {
      outcome: "discarded_reflection";
      evaluatedAt: string;
      candidateCount: number;
      candidate: TopicResurfaceCandidate;
      reflection: string;
    }
  | {
      outcome: "thought_seed_candidate";
      evaluatedAt: string;
      candidateCount: number;
      candidate: TopicResurfaceCandidate;
      text: string;
    };

type InternalLoopRunner = Pick<TopicResurfaceInternalLoopService, "runOnce">;

export class TopicResurfaceRetentionGateService {
  constructor(
    private readonly internalLoop: InternalLoopRunner,
    private readonly evaluator: TopicResurfaceRetentionEvaluator,
  ) {}

  async runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    candidateLimit: number;
  }): Promise<TopicResurfaceRetentionResult> {
    const internal = await this.internalLoop.runOnce(input);
    if (internal.outcome !== "reflection") {
      return internal;
    }

    let decision: TopicResurfaceRetentionDecision;
    try {
      decision = await this.evaluator.evaluate({
        evaluatedAt: internal.evaluatedAt,
        candidate: internal.candidate,
        reflection: internal.reflection,
      });
    } catch {
      return {
        outcome: "retention_failed",
        evaluatedAt: internal.evaluatedAt,
        candidateCount: internal.candidateCount,
        candidate: internal.candidate,
        reflection: internal.reflection,
      };
    }

    if (decision.decision === "discard") {
      return {
        outcome: "discarded_reflection",
        evaluatedAt: internal.evaluatedAt,
        candidateCount: internal.candidateCount,
        candidate: internal.candidate,
        reflection: internal.reflection,
      };
    }

    return {
      outcome: "thought_seed_candidate",
      evaluatedAt: internal.evaluatedAt,
      candidateCount: internal.candidateCount,
      candidate: internal.candidate,
      text: internal.reflection,
    };
  }
}
