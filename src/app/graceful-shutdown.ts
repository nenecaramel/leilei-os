import type {
  ShutdownObserverEvent,
  ShutdownStage,
} from "../observability/runtime-observers.js";

export const SHUTDOWN_DEADLINE_MS = 10_000;

type HttpServerLike = {
  close(callback: (error?: Error) => void): void;
};

export function createGracefulShutdownController(input: {
  server: HttpServerLike;
  closeMcpSessions: () => Promise<void>;
  stopBackgroundWork?: () => void;
  drainBackgroundWork: () => Promise<void>;
  closeDatabase: () => Promise<void>;
  exit: (code: number) => void;
  logInfo?: (message: string) => void;
  logError?: (message: string) => void;
  setDeadline?: (callback: () => void, milliseconds: number) => unknown;
  clearDeadline?: (handle: unknown) => void;
  observer?: (event: ShutdownObserverEvent) => void;
  now?: () => number;
}): (signal: "SIGINT" | "SIGTERM") => Promise<void> {
  let shutdownPromise: Promise<void> | null = null;
  let exited = false;
  const now = input.now ?? Date.now;

  const scheduleDeadline = input.setDeadline ?? ((callback, milliseconds) => {
    const handle = setTimeout(callback, milliseconds);
    handle.unref?.();
    return handle;
  });

  return (signal) => {
    if (shutdownPromise) return shutdownPromise;
    input.logInfo?.(`${signal} received; shutting down.`);
    const startedAt = now();

    shutdownPromise = new Promise<void>((resolve) => {
      let deadlineHandle: unknown;
      let deadlineFired = false;
      let settled = false;
      const failures: ShutdownStage[] = [];
      const observe = (event: ShutdownObserverEvent): void => {
        try {
          input.observer?.(event);
        } catch {
          // Observability must never affect shutdown behavior.
        }
      };
      const finish = (code: number): void => {
        if (settled) return;
        settled = true;
        if (!deadlineFired) input.clearDeadline?.(deadlineHandle);
        if (!exited) {
          exited = true;
          input.exit(code);
        }
        resolve();
      };

      observe({ name: "shutdown_started", signal });

      const httpDrained = new Promise<void>((resolveHttp, rejectHttp) => {
        try {
          input.server.close((error) => {
            if (error) rejectHttp(error);
            else resolveHttp();
          });
        } catch (error) {
          rejectHttp(error);
        }
      });
      input.stopBackgroundWork?.();

      deadlineHandle = scheduleDeadline(() => {
        if (settled) return;
        deadlineFired = true;
        observe({
          name: "shutdown_deadline_exceeded",
          durationMs: Math.max(0, now() - startedAt),
        });
        input.logError?.("Graceful shutdown deadline exceeded.");
        finish(1);
      }, SHUTDOWN_DEADLINE_MS);

      void (async () => {
        const capture = async (
          stage: ShutdownStage,
          operation: () => Promise<void>,
        ): Promise<void> => {
          if (settled) return;
          const stageStartedAt = now();
          try {
            await operation();
          } catch {
            failures.push(stage);
            observe({
              name: "shutdown_stage_failed",
              stage,
              durationMs: Math.max(0, now() - stageStartedAt),
            });
          }
        };

        await capture("mcp_sessions", input.closeMcpSessions);
        await capture("http_drain", () => httpDrained);
        await capture("background_work", input.drainBackgroundWork);
        await capture("database", input.closeDatabase);
        if (settled || deadlineFired) return;
        const success = failures.length === 0;
        observe({
          name: "shutdown_completed",
          success,
          durationMs: Math.max(0, now() - startedAt),
        });
        if (!success) {
          input.logError?.("Graceful shutdown failed.");
          finish(1);
          return;
        }
        finish(0);
      })().catch(() => {
        input.logError?.("Graceful shutdown failed.");
        finish(1);
      });
    });

    return shutdownPromise;
  };
}
