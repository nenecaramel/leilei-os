import {
  subjectStateBackgroundMutexKey,
  type BackgroundLoopOrchestrator,
  type BackgroundLoopPriority,
} from "./background-loop-orchestrator.js";

export type SubjectStateBackgroundRunner = {
  runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    limit?: number;
  }): Promise<unknown>;
};

export type SubjectStateMaintenanceKind = "decay";

export type SubjectStateBackgroundLoopPlan = {
  priority: BackgroundLoopPriority;
  cost: number;
  limit?: number;
};

export type SubjectStateBackgroundMaintenanceConfig = {
  decay?: SubjectStateBackgroundLoopPlan;
};

export type SubjectStateBackgroundMaintenanceRunners = {
  decay?: SubjectStateBackgroundRunner | null;
};

/**
 * Adapts Memory/Feel decay into the shared BackgroundLoopOrchestrator.
 *
 * Thought has no background maintenance: it is dropped by the subject or by
 * the active limit at write time, never by the clock. All Subject State
 * mutation jobs for one user+subject share one mutex key so a concurrent
 * orchestrator cannot interleave those writes.
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
  }

  schedule(input: {
    userId: string;
    kinds?: readonly SubjectStateMaintenanceKind[];
  }): void {
    const userId = input.userId.trim();
    if (!userId) {
      throw new Error(
        "Subject State background maintenance userId must not be blank.",
      );
    }
    const selected = new Set(input.kinds ?? ["decay"]);
    const plan = this.config.decay;
    const runner = this.runners.decay;
    if (!selected.has("decay") || !plan || !runner) return;

    this.orchestrator.schedule({
      key: "decay:" + userId + ":" + this.subjectId,
      kind: "decay",
      priority: plan.priority,
      cost: plan.cost,
      mutexKeys: [
        subjectStateBackgroundMutexKey({
          userId,
          subjectId: this.subjectId,
        }),
      ],
      run: async () => {
        await runner.runOnce({
          userId,
          subjectId: this.subjectId,
          now: normalizeIso(this.now()),
          ...(plan.limit === undefined ? {} : { limit: plan.limit }),
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

function normalizeIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Subject State background now() must return an ISO timestamp.",
    );
  }
  return new Date(parsed).toISOString();
}
