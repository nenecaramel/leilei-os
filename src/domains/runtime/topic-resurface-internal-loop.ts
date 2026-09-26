import type {
  TopicResurfaceCandidate,
} from "./topic-resurface-candidates.js";
import type {
  TopicResurfaceEvaluationResult,
  TopicResurfaceEvaluationService,
} from "./topic-resurface-evaluation.js";

export type TopicResurfaceDeliberationDecision =
  | { decision: "quiet" }
  | { decision: "reflect"; reflection: string };

export interface TopicResurfaceDeliberator {
  deliberate(input: {
    evaluatedAt: string;
    candidate: TopicResurfaceCandidate;
  }): Promise<TopicResurfaceDeliberationDecision>;
}

export type TopicResurfaceInternalLoopResult =
  | Extract<TopicResurfaceEvaluationResult, { outcome: "idle" | "quiet" | "model_failed" }>
  | {
      outcome: "deliberation_failed";
      evaluatedAt: string;
      candidateCount: number;
      candidate: TopicResurfaceCandidate;
    }
  | {
      outcome: "reflection";
      evaluatedAt: string;
      candidateCount: number;
      candidate: TopicResurfaceCandidate;
      reflection: string;
    };

type EvaluationRunner = Pick<TopicResurfaceEvaluationService, "runOnce">;

export class TopicResurfaceInternalLoopService {
  constructor(
    private readonly evaluation: EvaluationRunner,
    private readonly deliberator: TopicResurfaceDeliberator,
  ) {}

  async runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    candidateLimit: number;
  }): Promise<TopicResurfaceInternalLoopResult> {
    const evaluated = await this.evaluation.runOnce(input);
    if (evaluated.outcome !== "consider") {
      return evaluated;
    }

    let deliberation: TopicResurfaceDeliberationDecision;
    try {
      deliberation = await this.deliberator.deliberate({
        evaluatedAt: evaluated.evaluatedAt,
        candidate: evaluated.candidate,
      });
    } catch {
      return {
        outcome: "deliberation_failed",
        evaluatedAt: evaluated.evaluatedAt,
        candidateCount: evaluated.candidateCount,
        candidate: evaluated.candidate,
      };
    }

    if (deliberation.decision === "quiet") {
      return {
        outcome: "quiet",
        evaluatedAt: evaluated.evaluatedAt,
        candidateCount: evaluated.candidateCount,
      };
    }

    const reflection = normalizeReflection(deliberation.reflection);
    if (!reflection) {
      return {
        outcome: "deliberation_failed",
        evaluatedAt: evaluated.evaluatedAt,
        candidateCount: evaluated.candidateCount,
        candidate: evaluated.candidate,
      };
    }

    return {
      outcome: "reflection",
      evaluatedAt: evaluated.evaluatedAt,
      candidateCount: evaluated.candidateCount,
      candidate: evaluated.candidate,
      reflection,
    };
  }
}

export function normalizeReflection(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}
