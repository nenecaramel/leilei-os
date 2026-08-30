import { randomUUID } from "node:crypto";
import type {
  SentinelWakeEnqueueResult,
} from "./sentinel-types.js";

export const SENTINEL_SCHEDULER_INTERVAL_MS = 30_000;
export const SENTINEL_WAKE_RECOVERY_TIMEOUT_MS = 15 * 60 * 1_000;

export interface SentinelSchedulerRepository {
  createDueWake(now: Date | undefined, wakeId: string): Promise<SentinelWakeEnqueueResult>;
  markStaleWakeRuns(now: Date | undefined, timeoutMs: number): Promise<number>;
}

export interface SentinelScheduler {
  start(): void;
  stopScheduling(): void;
  drain(): Promise<void>;
  runOnce(now?: Date): Promise<number>;
}

type TimerHandle = {
  unref?: () => void;
};

type SchedulerOptions = {
  repository: SentinelSchedulerRepository;
  intervalMs?: number;
  createWakeId?: () => string;
  schedule?: (callback: () => void, milliseconds: number) => TimerHandle;
  clearSchedule?: (handle: TimerHandle) => void;
};

export function createSentinelScheduler(
  options: SchedulerOptions,
): SentinelScheduler {
  const intervalMs = options.intervalMs ?? SENTINEL_SCHEDULER_INTERVAL_MS;
  const createWakeId = options.createWakeId ?? randomUUID;
  const schedule = options.schedule ?? ((callback, milliseconds) =>
    setInterval(callback, milliseconds));
  const clearSchedule = options.clearSchedule ?? ((handle) =>
    clearInterval(handle as NodeJS.Timeout));

  let timer: TimerHandle | null = null;
  let inFlight: Promise<number> | null = null;
  let stopping = false;

  const runOnce = (at?: Date): Promise<number> => {
    if (stopping) return Promise.resolve(0);
    if (inFlight) return inFlight;
    const run = (async () => {
      await options.repository.markStaleWakeRuns(
        at,
        SENTINEL_WAKE_RECOVERY_TIMEOUT_MS,
      );
      const result = await options.repository.createDueWake(at, createWakeId());
      return result.outcome === "created" ? 1 : 0;
    })();
    const tracked = run.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return tracked;
  };

  const start = (): void => {
    if (stopping || timer) return;
    timer = schedule(() => {
      void runOnce().catch(() => undefined);
    }, intervalMs);
    timer.unref?.();
    void runOnce().catch(() => undefined);
  };

  const stopScheduling = (): void => {
    if (stopping) return;
    stopping = true;
    if (timer) {
      clearSchedule(timer);
      timer = null;
    }
  };

  const drain = async (): Promise<void> => {
    if (inFlight) await inFlight.catch(() => undefined);
  };

  return { start, stopScheduling, drain, runOnce };
}
