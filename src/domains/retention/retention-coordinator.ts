import { type RetentionPolicy, runBoundedRetention } from "./retention-policy.js";

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
    }
  | {
      name: "native_live_background_model_jobs_cleanup_completed";
      policy: "native_live_background_model_jobs";
      deletedRows: number;
      batches: number;
      capped: boolean;
      durationMs: number;
    }
  | {
      name: "native_live_background_model_jobs_cleanup_failed";
      policy: "native_live_background_model_jobs";
      batches: number;
      durationMs: number;
    }
  | {
      name: "native_live_chat_attachments_cleanup_completed";
      policy: "native_live_chat_attachments";
      deletedRows: number;
      batches: number;
      capped: boolean;
      durationMs: number;
    }
  | {
      name: "native_live_chat_attachments_cleanup_failed";
      policy: "native_live_chat_attachments";
      batches: number;
      durationMs: number;
    }
  | {
      name: "runtime_operational_records_cleanup_completed";
      policy: "runtime_operational_records";
      deletedRows: number;
      batches: number;
      capped: boolean;
      durationMs: number;
    }
  | {
      name: "runtime_operational_records_cleanup_failed";
      policy: "runtime_operational_records";
      batches: number;
      durationMs: number;
    };

export type RetentionCoordinatorOptions = {
  intervalMs: number;
  policies: readonly RetentionPolicyRunner[];
  now?: () => number;
  schedule?: (
    callback: () => void,
    milliseconds: number,
  ) => { unref?: () => void };
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
  const schedule =
    options.schedule ??
    ((callback, milliseconds) => setInterval(callback, milliseconds));
  const clearSchedule =
    options.clearSchedule ??
    ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
  let intervalHandle: { unref?: () => void } | null = null;
  let inFlight: Promise<void> | null = null;
  let stopping = false;

  const emit = (event: RetentionCoordinatorEvent): void => {
    try {
      options.observe?.(event);
    } catch {
      // Observability must never affect retention correctness.
    }
  };

  const runPolicy = async (policy: RetentionPolicyRunner): Promise<void> => {
    const startedAt = now();
    let batches = 0;
    try {
      const result = await runBoundedRetention(async (limit) => {
        batches += 1;
        return policy.deleteBatch(new Date(startedAt - policy.retentionMs), limit);
      });
      const completedName = policy.policy === "mcp_write_idempotency"
        ? "mcp_idempotency_cleanup_completed"
        : policy.policy === "data_import_runs"
          ? "data_import_runs_cleanup_completed"
          : policy.policy === "native_live_background_model_jobs"
            ? "native_live_background_model_jobs_cleanup_completed"
            : policy.policy === "native_live_chat_attachments"
              ? "native_live_chat_attachments_cleanup_completed"
              : "runtime_operational_records_cleanup_completed";
      emit({
        name: completedName,
        policy: policy.policy,
        deletedRows: result.deletedRows,
        batches: result.batches,
        capped: result.capped,
        durationMs: Math.max(0, now() - startedAt),
      } as RetentionCoordinatorEvent);
    } catch {
      emit({
        name: policy.policy === "mcp_write_idempotency"
          ? "mcp_idempotency_cleanup_failed"
          : policy.policy === "data_import_runs"
            ? "data_import_runs_cleanup_failed"
            : policy.policy === "native_live_background_model_jobs"
              ? "native_live_background_model_jobs_cleanup_failed"
              : policy.policy === "native_live_chat_attachments"
                ? "native_live_chat_attachments_cleanup_failed"
                : "runtime_operational_records_cleanup_failed",
        policy: policy.policy,
        batches,
        durationMs: Math.max(0, now() - startedAt),
      } as RetentionCoordinatorEvent);
    }
  };

  const runAllPolicies = async (): Promise<void> => {
    for (const policy of options.policies) {
      await runPolicy(policy);
    }
  };

  const runNow = (): Promise<void> => {
    if (inFlight) return inFlight;
    if (stopping) return Promise.resolve();
    const operation = runAllPolicies().finally(() => {
      inFlight = null;
    });
    inFlight = operation;
    return operation;
  };

  return {
    start(): void {
      if (stopping || intervalHandle) return;
      intervalHandle = schedule(() => {
        void runNow();
      }, options.intervalMs);
      intervalHandle.unref?.();
      void runNow();
    },
    stopScheduling(): void {
      if (stopping) return;
      stopping = true;
      if (intervalHandle) {
        clearSchedule(intervalHandle);
        intervalHandle = null;
      }
    },
    runNow,
    async drain(): Promise<void> {
      const current = inFlight;
      if (current) await current;
    },
  };
}
