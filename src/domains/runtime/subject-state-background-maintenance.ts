
import type { BackgroundLoopOrchestrator } from "./background-loop-orchestrator.js";
import type {
  SubjectStateEvolutionRunner,
} from "./subject-state-evolution-contract.js";
import {
  subjectStateBackgroundMutexKey,
  type BackgroundLoopPriority,
} from "./background-loop-orchestrator.js";

export type SubjectStateBackgroundRunner = SubjectStateEvolutionRunner;

export type SubjectStateBackgroundLoopPlan = {
  priority: BackgroundLoopPriority;
  cost: number;
  limit?: number;
};

export type SubjectStateBackgroundMaintenanceConfig = {
  decay?: SubjectStateBackgroundLoopPlan;
  thoughtEvolution?: SubjectStateBackgroundLoopPlan;
  driveEvolution?: SubjectStateBackgroundLoopPlan;
  topicLifecycle?: SubjectStateBackgroundLoopPlan;
};

export type SubjectStateBackgroundMaintenanceRunners = {
  decay?: SubjectStateBackgroundRunner | null;
  thoughtEvolution?: SubjectStateBackgroundRunner | null;
  driveEvolution?: SubjectStateBackgroundRunner | null;
  curiosityTopicProjection?: SubjectStateBackgroundRunner | null;
  topicEvolution?: SubjectStateBackgroundRunner | null;
};

/**
 * Adapts existing Subject State maintenance services into the shared
 * BackgroundLoopOrchestrator without changing their domain semantics.
 *
 * Topic lifecycle remains one ordered job: Curiosity projection first, Topic
 * evolution second. All Subject State mutation jobs for one user+subject share
 * one mutex key, so a configured concurrent orchestrator cannot interleave
 * those writes.
 */
export class SubjectStateBackgroundMaintenance {
  constructor(
    private readonly orchestrator: Pick<
      BackgroundLoopOrchestrator,
      "schedule"
    >,
    private readonly subjectId: string,
    private readonly runners: SubjectStateBackgroundMaintenanceRunners,
    private readonly config: SubjectStateBackgroundMaintenanceConfig,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    if (!subjectId.trim()) {
      throw new Error(
        "Subject State background maintenance subjectId must not be blank.",
      );
    }
    validatePlan("decay", config.decay, runners.decay);
    validatePlan(
      "thoughtEvolution",
      config.thoughtEvolution,
      runners.thoughtEvolution,
    );
    validatePlan(
      "driveEvolution",
      config.driveEvolution,
      runners.driveEvolution,
    );
    validateTopicPlan(config.topicLifecycle, runners);
  }

  schedule(input: { userId: string }): void {
    const userId = input.userId.trim();
    if (!userId) {
      throw new Error(
        "Subject State background maintenance userId must not be blank.",
      );
    }
    const mutex = subjectStateBackgroundMutexKey({
      userId,
      subjectId: this.subjectId,
    });

    if (this.config.decay && this.runners.decay) {
      this.scheduleOne({
        userId,
        mutex,
        key: "decay",
        kind: "decay",
        plan: this.config.decay,
        runner: this.runners.decay,
      });
    }
    if (
      this.config.thoughtEvolution
      && this.runners.thoughtEvolution
    ) {
      this.scheduleOne({
        userId,
        mutex,
        key: "thought-evolution",
        kind: "thought_evolution",
        plan: this.config.thoughtEvolution,
        runner: this.runners.thoughtEvolution,
      });
    }
    if (
      this.config.driveEvolution
      && this.runners.driveEvolution
    ) {
      this.scheduleOne({
        userId,
        mutex,
        key: "drive-evolution",
        kind: "drive_evolution",
        plan: this.config.driveEvolution,
        runner: this.runners.driveEvolution,
      });
    }
    if (
      this.config.topicLifecycle
      && (
        this.runners.curiosityTopicProjection
        || this.runners.topicEvolution
      )
    ) {
      const plan = this.config.topicLifecycle;
      this.orchestrator.schedule({
        key:
          "topic-lifecycle:"
          + userId
          + ":"
          + this.subjectId,
        kind: "topic_lifecycle",
        priority: plan.priority,
        cost: plan.cost,
        mutexKeys: [mutex],
        run: async () => {
          const now = normalizeIso(this.now());
          if (this.runners.curiosityTopicProjection) {
            await this.runners.curiosityTopicProjection.runOnce({
              userId,
              subjectId: this.subjectId,
              now,
              ...(plan.limit === undefined
                ? {}
                : { limit: plan.limit }),
            });
          }
          if (this.runners.topicEvolution) {
            await this.runners.topicEvolution.runOnce({
              userId,
              subjectId: this.subjectId,
              now,
              ...(plan.limit === undefined
                ? {}
                : { limit: plan.limit }),
            });
          }
        },
      });
    }
  }

  private scheduleOne(input: {
    userId: string;
    mutex: string;
    key: string;
    kind: "decay" | "thought_evolution" | "drive_evolution";
    plan: SubjectStateBackgroundLoopPlan;
    runner: SubjectStateBackgroundRunner;
  }): void {
    this.orchestrator.schedule({
      key:
        input.key
        + ":"
        + input.userId
        + ":"
        + this.subjectId,
      kind: input.kind,
      priority: input.plan.priority,
      cost: input.plan.cost,
      mutexKeys: [input.mutex],
      run: async () => {
        await input.runner.runOnce({
          userId: input.userId,
          subjectId: this.subjectId,
          now: normalizeIso(this.now()),
          ...(input.plan.limit === undefined
            ? {}
            : { limit: input.plan.limit }),
        });
      },
    });
  }
}

function validatePlan(
  name: string,
  plan: SubjectStateBackgroundLoopPlan | undefined,
  runner: SubjectStateBackgroundRunner | null | undefined,
): void {
  if (Boolean(plan) !== Boolean(runner)) {
    throw new Error(
      "Background maintenance " + name
      + " requires both runner and explicit plan.",
    );
  }
  if (!plan) return;
  if (!Number.isInteger(plan.cost) || plan.cost < 1) {
    throw new Error(
      "Background maintenance " + name
      + " cost must be a positive integer.",
    );
  }
  if (
    plan.limit !== undefined
    && (!Number.isInteger(plan.limit) || plan.limit < 1)
  ) {
    throw new Error(
      "Background maintenance " + name
      + " limit must be a positive integer.",
    );
  }
}

function validateTopicPlan(
  plan: SubjectStateBackgroundLoopPlan | undefined,
  runners: SubjectStateBackgroundMaintenanceRunners,
): void {
  const hasRunner = Boolean(
    runners.curiosityTopicProjection || runners.topicEvolution,
  );
  if (Boolean(plan) !== hasRunner) {
    throw new Error(
      "Background maintenance topicLifecycle requires an explicit plan "
      + "when either Topic runner is configured.",
    );
  }
  if (plan) {
    validatePlan(
      "topicLifecycle",
      plan,
      runners.curiosityTopicProjection ?? runners.topicEvolution,
    );
  }
}

function normalizeIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Subject State background now() must return an ISO timestamp.",
    );
  }
  return new Date(parsed).toISOString();
}
