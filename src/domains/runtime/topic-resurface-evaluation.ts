import type {
  TopicResurfaceCandidate,
  TopicResurfaceCandidateService,
} from "./topic-resurface-candidates.js";

export type TopicResurfaceEvaluationDecision =
  | { decision: "quiet" }
  | { decision: "consider"; stateId: string };

export interface TopicResurfaceEvaluator {
  evaluate(input: {
    evaluatedAt: string;
    candidates: readonly TopicResurfaceCandidate[];
  }): Promise<TopicResurfaceEvaluationDecision>;
}

export type TopicResurfaceEvaluationResult =
  | {
      outcome: "idle";
      evaluatedAt: string;
      candidateCount: 0;
    }
  | {
      outcome: "quiet";
      evaluatedAt: string;
      candidateCount: number;
    }
  | {
      outcome: "consider";
      evaluatedAt: string;
      candidateCount: number;
      candidate: TopicResurfaceCandidate;
    }
  | {
      outcome: "model_failed";
      evaluatedAt: string;
      candidateCount: number;
    };

type CandidateReader = Pick<TopicResurfaceCandidateService, "list">;

export class TopicResurfaceEvaluationService {
  constructor(
    private readonly candidates: CandidateReader,
    private readonly evaluator: TopicResurfaceEvaluator,
  ) {}

  async runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    candidateLimit: number;
  }): Promise<TopicResurfaceEvaluationResult> {
    const evaluatedAt = normalizeIso(input.now, "now");
    const listed = await this.candidates.list({
      userId: input.userId,
      subjectId: input.subjectId,
      limit: input.candidateLimit,
    });
    if (listed.candidates.length === 0) {
      return {
        outcome: "idle",
        evaluatedAt,
        candidateCount: 0,
      };
    }

    let decision: TopicResurfaceEvaluationDecision;
    try {
      decision = await this.evaluator.evaluate({
        evaluatedAt,
        candidates: listed.candidates,
      });
    } catch {
      return {
        outcome: "model_failed",
        evaluatedAt,
        candidateCount: listed.candidates.length,
      };
    }

    if (decision.decision === "quiet") {
      return {
        outcome: "quiet",
        evaluatedAt,
        candidateCount: listed.candidates.length,
      };
    }

    const selected = listed.candidates.find(
      (candidate) => candidate.stateId === decision.stateId,
    );
    if (!selected) {
      return {
        outcome: "model_failed",
        evaluatedAt,
        candidateCount: listed.candidates.length,
      };
    }

    return {
      outcome: "consider",
      evaluatedAt,
      candidateCount: listed.candidates.length,
      candidate: selected,
    };
  }
}

function normalizeIso(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return new Date(parsed).toISOString();
}
