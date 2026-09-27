import type {
  CuriosityEvolutionRunResult,
} from "./curiosity-evolution.js";
import type {
  SubjectStateEvolutionRunMode,
} from "./subject-state-evolution-contract.js";

export type CuriosityResolutionResult =
  | {
      outcome: "applied" | "idempotent";
      curiosityStateId: string;
      resolvedAt: string;
      resolutionSourceId: string;
      updatedStates: number;
    }
  | {
      outcome: "rejected";
      code:
        | "CURIOSITY_NOT_FOUND"
        | "CURIOSITY_NOT_ELIGIBLE"
        | "CURIOSITY_NOT_EVOLVED"
        | "CURIOSITY_NOT_ACTIVE"
        | "IDEMPOTENCY_CONFLICT";
    };

export interface CuriosityResolutionRuntimePort {
  resolve(input: {
    userId: string;
    subjectId: string;
    curiosityStateId: string;
    conversationId: string;
    resolutionSourceId: string;
    idempotencyKey: string;
    now: string;
  }): Promise<CuriosityResolutionResult>;
}

export interface CuriosityResolutionEvolutionRunner {
  runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    limit?: number;
    mode?: SubjectStateEvolutionRunMode;
  }): Promise<CuriosityEvolutionRunResult>;
}

export class CuriosityResolutionService {
  constructor(
    private readonly evolution: CuriosityResolutionEvolutionRunner,
    private readonly port: CuriosityResolutionRuntimePort,
  ) {}

  async resolve(input: {
    userId: string;
    subjectId: string;
    curiosityStateId: string;
    conversationId: string;
    resolutionSourceId: string;
    idempotencyKey: string;
    now: string;
  }): Promise<CuriosityResolutionResult> {
    await this.evolution.runOnce({
      userId: input.userId,
      subjectId: input.subjectId,
      now: input.now,
      mode: "settlement_catch_up",
    });
    return this.port.resolve(input);
  }
}
