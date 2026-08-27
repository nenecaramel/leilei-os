import {
  runBoundedRetention,
  type RetentionPolicy,
} from "./retention-policy.js";

export type RetentionPolicyRunner = {
  policy: RetentionPolicy;
  retentionMs: number;
  deleteBatch: (cutoff: Date, limit: number) => Promise<number>;
};

export type RetentionCoordinatorEvent =
  | {
    name: "mcp_idempotency_cleanup_completed";
    policy: "mcp_write_idempotency";
    deletedRows: number;
    batches: number;
    capped: boolean;
    durationMs: number;
  }
  | {
    name: "mcp_idempotency_cleanup_failed";
    policy: "mcp_write_idempotency";
    batches: number;
    durationMs: number;
  }
  | {
    name: "data_import_runs_cleanup_completed";
    policy: "data_import_runs";
    deletedRows: number;
    batches: number;
    capped: boolean;
    durationMs: number;
  }
  | {
    name: "data_import_runs_cleanup_failed";
    policy: "data_import_runs";
    batches: number;
    durationMs: number;
  };

export type RetentionCoordinatorOptions = {
  intervalMs: number;
  policies: readonly RetentionPolicyRunner[];
  now?: () => number;
  schedule?: (callback: () => void, milliseconds: number) => { unref?: () => void };
  clearSchedule?: (handle: unknown) => void;
  observe?: (event: RetentionCoordinatorEvent) => void;
};

export type RetentionCoordinator = {
  start(): void;
  stopScheduling(): void;
  runNow(): Promise<void>;
  drain(): Promise<void>;
};

export function createRetentionCoordinator(
  options: RetentionCoordinatorOptions,
): RetentionCoordinator {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback, milliseconds) => setInterval(callback, milliseconds));
  const clearSchedule = options.clearSchedule ?? ((handle) => clearInterval(handle as NodeJS.Timeout));
  let inFlight: Promise<void> | null = null;
  let intervalHandle: unknown;
  let started = false;
  let stopping = false;

  function observe(event: RetentionCoordinatorEvent): void {
    try {
      options.observe?.(event);
    } catch {
      // Retention must not depend on observability availability.
    }
  }

  async function runPolicy(policy: RetentionPolicyRunner): Promise<void> {
    const startedAt = now();
    const cutoff = new Date(startedAt - policy.retentionMs);
    let batches = 0;

    try {
      const result = await runBoundedRetention((limit) => {
        batches += 1;
        return policy.deleteBatch(cutoff, limit);
      });
      const durationMs = now() - startedAt;
      if (policy.policy === "mcp_write_idempotency") {
        observe({
          name: "mcp_idempotency_cleanup_completed",
          policy: "mcp_write_idempotency",
          ...result,
          durationMs,
        });
      } else {
        observe({
          name: "data_import_runs_cleanup_completed",
          policy: "data_import_runs",
          ...result,
          durationMs,
        });
      }
    } catch {
      const durationMs = now() - startedAt;
      if (policy.policy === "mcp_write_idempotency") {
        observe({
          name: "mcp_idempotency_cleanup_failed",
          policy: "mcp_write_idempotency",
          batches,
          durationMs,
        });
      } else {
        observe({
          name: "data_import_runs_cleanup_failed",
          policy: "data_import_runs",
          batches,
          durationMs,
        });
      }
    }
  }

  async function runPolicies(): Promise<void> {
    for (const policy of options.policies) {
      await runPolicy(policy);
    }
  }

  function runNow(): Promise<void> {
    if (stopping) return Promise.resolve();
    if (inFlight) return inFlight;

    const work = runPolicies();
    inFlight = work;
    void work.then(
      () => { if (inFlight === work) inFlight = null; },
      () => { if (inFlight === work) inFlight = null; },
    );
    return work;
  }

  return {
    start(): void {
      if (started || stopping) return;
      started = true;
      intervalHandle = schedule(() => { void runNow(); }, options.intervalMs);
      (intervalHandle as { unref?: () => void }).unref?.();
      void runNow();
    },
    stopScheduling(): void {
      if (stopping) return;
      stopping = true;
      if (intervalHandle === undefined) return;
      clearSchedule(intervalHandle);
      intervalHandle = undefined;
    },
    runNow,
    drain(): Promise<void> {
      return inFlight ?? Promise.resolve();
    },
  };
}
