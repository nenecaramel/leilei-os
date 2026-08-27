export const SHUTDOWN_DEADLINE_MS = 10_000;

type HttpServerLike = {
  close(callback: (error?: Error) => void): void;
};

export function createGracefulShutdownController(input: {
  server: HttpServerLike;
  closeMcpSessions: () => Promise<void>;
  drainBackgroundWork: () => Promise<void>;
  closeDatabase: () => Promise<void>;
  exit: (code: number) => void;
  logInfo?: (message: string) => void;
  logError?: (message: string) => void;
  setDeadline?: (callback: () => void, milliseconds: number) => unknown;
  clearDeadline?: (handle: unknown) => void;
}): (signal: "SIGINT" | "SIGTERM") => Promise<void> {
  let shutdownPromise: Promise<void> | null = null;
  let exited = false;

  const scheduleDeadline = input.setDeadline ?? ((callback, milliseconds) => {
    const handle = setTimeout(callback, milliseconds);
    handle.unref?.();
    return handle;
  });

  return (signal) => {
    if (shutdownPromise) return shutdownPromise;
    input.logInfo?.(`${signal} received; shutting down.`);

    shutdownPromise = new Promise<void>((resolve) => {
      let deadlineHandle: unknown;
      let deadlineFired = false;
      let settled = false;
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

      deadlineHandle = scheduleDeadline(() => {
        deadlineFired = true;
        input.logError?.("Graceful shutdown deadline exceeded.");
        finish(1);
      }, SHUTDOWN_DEADLINE_MS);

      void (async () => {
        const failures: unknown[] = [];
        const capture = async (operation: Promise<void>): Promise<void> => {
          try {
            await operation;
          } catch (error) {
            failures.push(error);
          }
        };

        await capture(input.closeMcpSessions());
        await capture(httpDrained);
        await capture(input.drainBackgroundWork());
        await capture(input.closeDatabase());
        if (failures.length > 0) {
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
