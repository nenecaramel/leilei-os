
export type BackgroundLoopKind =
  | "decay"
  | "proactivity_wake"
  | "effect_delivery";

export type BackgroundLoopPriority =
  | "consolidation"
  | "maintenance"
  | "reflection";

export type BackgroundLoopJob = {
  key: string;
  kind: BackgroundLoopKind;
  priority: BackgroundLoopPriority;
  cost: number;
  mutexKeys: readonly string[];
  run(): Promise<unknown>;
};

export type BackgroundLoopOrchestratorConfig = {
  maxRunsPerCycle: number;
  maxCostPerCycle: number;
  maxConcurrent: number;
};

export type BackgroundLoopObserverEvent =
  | {
      name: "background_loop_job_started";
      key: string;
      kind: BackgroundLoopKind;
      priority: BackgroundLoopPriority;
      cost: number;
    }
  | {
      name: "background_loop_job_completed";
      key: string;
      kind: BackgroundLoopKind;
    }
  | {
      name: "background_loop_job_failed";
      key: string;
      kind: BackgroundLoopKind;
      errorName: string;
    }
  | {
      name: "background_loop_cycle_budget_exhausted";
      pending: number;
      runsStarted: number;
      costStarted: number;
    };

export type BackgroundLoopCycleSummary = {
  runsStarted: number;
  completed: number;
  failed: number;
  costStarted: number;
  pending: number;
  budgetExhausted: boolean;
};

type PendingJob = {
  job: BackgroundLoopJob;
  sequence: number;
};

type ActiveJob = {
  promise: Promise<void>;
  mutexKeys: string[];
};

const PRIORITY_RANK: Record<BackgroundLoopPriority, number> = {
  consolidation: 0,
  maintenance: 1,
  reflection: 2,
};

/**
 * Shared in-process execution boundary for internal background work.
 *
 * Scheduling is intentionally not cadence. schedule() only records an
 * opportunity and starts at most one bounded cycle. No timer is owned here,
 * no scheduler history is persisted, and a depleted cycle never self-restarts.
 * Another external opportunity must call schedule() or kick() again.
 *
 * Jobs are fail-soft and may run concurrently only when their mutex sets are
 * disjoint. This lets callers serialize all mutations for one Subject while
 * still permitting unrelated users/resources to make progress.
 */
export class BackgroundLoopOrchestrator {
  private readonly pending = new Map<string, PendingJob>();
  private worker: Promise<BackgroundLoopCycleSummary> | null = null;
  private nextSequence = 0;
  private lastSummary: BackgroundLoopCycleSummary | null = null;

  constructor(
    private readonly config: BackgroundLoopOrchestratorConfig,
    private readonly observe?: (event: BackgroundLoopObserverEvent) => void,
  ) {
    validateConfig(config);
  }

  schedule(job: BackgroundLoopJob): void {
    const normalized = normalizeJob(job);
    const current = this.pending.get(normalized.key);
    this.pending.set(normalized.key, {
      job: normalized,
      sequence: current?.sequence ?? this.nextSequence++,
    });
    this.ensureWorker();
  }

  /**
   * Starts one bounded cycle for already-pending work.
   * This is useful when the previous cycle stopped at its budget boundary.
   */
  kick(): void {
    if (this.pending.size === 0) return;
    this.ensureWorker();
  }

  /**
   * Waits only for the currently active bounded cycle. Pending work left by a
   * budget boundary is intentionally not auto-drained.
   */
  async drain(): Promise<BackgroundLoopCycleSummary | null> {
    const active = this.worker;
    if (!active) return this.lastSummary;
    return active;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  private ensureWorker(): void {
    if (this.worker) return;
    this.worker = Promise.resolve()
      .then(() => this.runCycle())
      .then((summary) => {
        this.lastSummary = summary;
        return summary;
      })
      .finally(() => {
        this.worker = null;
      });
  }

  private async runCycle(): Promise<BackgroundLoopCycleSummary> {
    let runsStarted = 0;
    let completed = 0;
    let failed = 0;
    let costStarted = 0;
    const locked = new Set<string>();
    const active = new Set<ActiveJob>();

    const startOne = (pending: PendingJob): void => {
      const { job } = pending;
      this.pending.delete(job.key);
      runsStarted += 1;
      costStarted += job.cost;
      for (const key of job.mutexKeys) locked.add(key);
      this.emit({
        name: "background_loop_job_started",
        key: job.key,
        kind: job.kind,
        priority: job.priority,
        cost: job.cost,
      });

      const activeJob: ActiveJob = {
        mutexKeys: [...job.mutexKeys],
        promise: Promise.resolve()
          .then(() => job.run())
          .then(() => {
            completed += 1;
            this.emit({
              name: "background_loop_job_completed",
              key: job.key,
              kind: job.kind,
            });
          })
          .catch((error) => {
            failed += 1;
            this.emit({
              name: "background_loop_job_failed",
              key: job.key,
              kind: job.kind,
              errorName:
                error instanceof Error ? error.name : "UnknownError",
            });
          })
          .finally(() => {
            active.delete(activeJob);
            for (const key of activeJob.mutexKeys) locked.delete(key);
          }),
      };
      active.add(activeJob);
    };

    for (;;) {
      while (
        active.size < this.config.maxConcurrent
        && runsStarted < this.config.maxRunsPerCycle
      ) {
        const remainingCost =
          this.config.maxCostPerCycle - costStarted;
        const next = this.nextRunnable(locked, remainingCost);
        if (!next) break;
        startOne(next);
      }

      if (active.size > 0) {
        await Promise.race([...active].map((item) => item.promise));
        continue;
      }

      const budgetExhausted =
        this.pending.size > 0
        && (
          runsStarted >= this.config.maxRunsPerCycle
          || !this.hasAffordablePending(
            this.config.maxCostPerCycle - costStarted,
          )
        );

      if (budgetExhausted) {
        this.emit({
          name: "background_loop_cycle_budget_exhausted",
          pending: this.pending.size,
          runsStarted,
          costStarted,
        });
      }

      return {
        runsStarted,
        completed,
        failed,
        costStarted,
        pending: this.pending.size,
        budgetExhausted,
      };
    }
  }

  private nextRunnable(
    locked: ReadonlySet<string>,
    remainingCost: number,
  ): PendingJob | null {
    return [...this.pending.values()]
      .filter(({ job }) =>
        job.cost <= remainingCost
        && job.mutexKeys.every((key) => !locked.has(key)),
      )
      .sort(comparePending)[0] ?? null;
  }

  private hasAffordablePending(remainingCost: number): boolean {
    return [...this.pending.values()].some(
      ({ job }) => job.cost <= remainingCost,
    );
  }

  private emit(event: BackgroundLoopObserverEvent): void {
    try {
      this.observe?.(event);
    } catch {
      // Observability is never allowed to turn background work into failure.
    }
  }
}

export function subjectStateBackgroundMutexKey(input: {
  userId: string;
  subjectId: string;
}): string {
  const userId = input.userId.trim();
  const subjectId = input.subjectId.trim();
  if (!userId || !subjectId) {
    throw new Error("Background Subject identity must not be blank.");
  }
  return "subject-state:" + userId + ":\u0000:" + subjectId;
}

export function conversationBackgroundMutexKey(input: {
  userId: string;
  conversationId: string;
}): string {
  const userId = input.userId.trim();
  const conversationId = input.conversationId.trim();
  if (!userId || !conversationId) {
    throw new Error("Background conversation identity must not be blank.");
  }
  return "conversation:" + userId + ":\u0000:" + conversationId;
}

export const CLAUDE_CODE_BACKGROUND_MUTEX =
  "model-runtime:claude-code";

function comparePending(left: PendingJob, right: PendingJob): number {
  return (
    PRIORITY_RANK[left.job.priority] - PRIORITY_RANK[right.job.priority]
    || left.sequence - right.sequence
    || left.job.key.localeCompare(right.job.key)
  );
}

function normalizeJob(job: BackgroundLoopJob): BackgroundLoopJob {
  const key = job.key.trim();
  if (!key) throw new Error("Background loop job key must not be blank.");
  if (!Number.isInteger(job.cost) || job.cost < 1) {
    throw new Error("Background loop job cost must be a positive integer.");
  }
  const mutexKeys = [...new Set(job.mutexKeys.map((value) => value.trim()))];
  if (mutexKeys.some((value) => !value)) {
    throw new Error("Background loop mutex key must not be blank.");
  }
  return {
    ...job,
    key,
    mutexKeys,
  };
}

function validateConfig(config: BackgroundLoopOrchestratorConfig): void {
  for (const [label, value] of [
    ["maxRunsPerCycle", config.maxRunsPerCycle],
    ["maxCostPerCycle", config.maxCostPerCycle],
    ["maxConcurrent", config.maxConcurrent],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(
        "Background loop " + label + " must be a positive integer.",
      );
    }
  }
}
