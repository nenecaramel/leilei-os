import type { SubjectStateTransition } from "./native-live-mind-loop-service.js";
import type {
  SubjectStateEvolutionRunner,
} from "./subject-state-evolution-contract.js";

export type SubjectStateEvolutionRunners = {
  thoughtEvolution?: SubjectStateEvolutionRunner | null;
  driveEvolution?: SubjectStateEvolutionRunner | null;
  curiosityEvolution?: SubjectStateEvolutionRunner | null;
  curiosityTopicProjection?: SubjectStateEvolutionRunner | null;
  topicEvolution?: SubjectStateEvolutionRunner | null;
};

/**
 * Foreground-only bridge between path settlement and Context Assembly.
 *
 * This is deliberately not general maintenance. It runs only when the current
 * user continuation has just settled a Subject State whose derived payload is
 * required for the same turn's Context Assembly. Time-based decay, dormancy,
 * and periodic evolution remain Background Loop responsibilities.
 *
 * Every runner is fail-soft: derived-state catch-up must never block the user
 * turn or rewrite canonical conversation history.
 */
export class SubjectStateSettlementCatchUp {
  constructor(
    private readonly subjectId: string,
    private readonly runners: SubjectStateEvolutionRunners,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    if (!subjectId.trim()) {
      throw new Error("Subject State settlement catch-up subjectId must not be blank.");
    }
  }

  async run(input: {
    userId: string;
    transitions: readonly SubjectStateTransition[];
  }): Promise<void> {
    const settledKinds = new Set(
      input.transitions
        .filter((transition) =>
          transition.reason === "user_continued_current_path"
          && transition.settlementStatus === "settled"
          && transition.pathStatus === "current"
          && transition.validityStatus === "valid"
        )
        .map((transition) => transition.stateKind),
    );
    if (settledKinds.size === 0) return;

    let now: string;
    try {
      now = normalizeIso(this.now());
    } catch {
      return;
    }

    if (settledKinds.has("drive")) {
      await this.runOne(this.runners.driveEvolution, input.userId, now);
    }
    if (settledKinds.has("thought")) {
      await this.runOne(this.runners.thoughtEvolution, input.userId, now);
    }

    const settledCuriosity = settledKinds.has("curiosity");
    if (settledCuriosity) {
      await this.runOne(
        this.runners.curiosityEvolution,
        input.userId,
        now,
      );
      await this.runOne(
        this.runners.curiosityTopicProjection,
        input.userId,
        now,
      );
    }
    if (settledCuriosity || settledKinds.has("topic")) {
      await this.runOne(this.runners.topicEvolution, input.userId, now);
    }
  }

  private async runOne(
    runner: SubjectStateEvolutionRunner | null | undefined,
    userId: string,
    now: string,
  ): Promise<void> {
    if (!runner) return;
    try {
      await runner.runOnce({
        userId,
        subjectId: this.subjectId,
        now,
        mode: "settlement_catch_up",
      });
    } catch {
      // Settlement catch-up is derived and fail-soft for the foreground turn.
    }
  }
}

function normalizeIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Subject State settlement catch-up now() must return an ISO timestamp.",
    );
  }
  return new Date(parsed).toISOString();
}
