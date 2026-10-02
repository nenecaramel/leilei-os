import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type NativeLiveMacDaemonLock = {
  path: string;
  release(): void;
};

export function acquireNativeLiveMacDaemonLock(
  options: {
    baseDir?: string;
    pid?: number;
    now?: () => Date;
    isPidAlive?: (pid: number) => boolean;
  } = {},
): NativeLiveMacDaemonLock {
  const baseDir =
    options.baseDir ?? join(homedir(), ".leileios");
  const lockPath = join(baseDir, "native-live-daemon.lock");
  const pid = options.pid ?? process.pid;
  const now = options.now ?? (() => new Date());
  const isPidAlive =
    options.isPidAlive ?? defaultIsPidAlive;

  mkdirSync(baseDir, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, "owner.json"),
        JSON.stringify({
          pid,
          started_at: now().toISOString(),
        }) + "\n",
        {
          encoding: "utf8",
          flag: "wx",
        },
      );

      let released = false;
      return {
        path: lockPath,
        release() {
          if (released) return;
          released = true;
          rmSync(lockPath, {
            recursive: true,
            force: true,
          });
        },
      };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;

      const ownerPid = readOwnerPid(lockPath);
      if (
        ownerPid !== null
        && ownerPid !== pid
        && isPidAlive(ownerPid)
      ) {
        throw new Error(
          `Native Live Mac daemon is already running (pid ${ownerPid}).`,
        );
      }

      // A crashed process can leave the directory behind. Remove only a
      // demonstrably stale/unreadable lock, then retry the atomic mkdir once.
      rmSync(lockPath, {
        recursive: true,
        force: true,
      });
    }
  }

  throw new Error(
    "Native Live Mac daemon lock could not be acquired.",
  );
}

function readOwnerPid(lockPath: string): number | null {
  try {
    const parsed = JSON.parse(
      readFileSync(
        join(lockPath, "owner.json"),
        "utf8",
      ),
    ) as { pid?: unknown };
    return (
      Number.isInteger(parsed.pid)
      && (parsed.pid as number) > 0
    )
      ? parsed.pid as number
      : null;
  } catch {
    return null;
  }
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "EPERM"
    );
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "EEXIST"
  );
}
