const TRANSIENT_DATABASE_NOT_READY_CODES = new Set([
  "57P03",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
]);

export const MIGRATION_READINESS_MAX_ATTEMPTS = 8;
// Runtime HTTP readiness needs a longer serverless wake budget than migrations.
// With the current capped backoff, 26 attempts include 91.5s of retry delay
// even when transient probes fail immediately.
export const RUNTIME_DATABASE_READINESS_MAX_ATTEMPTS = 26;
export const MIGRATION_READINESS_BACKOFF_MS = 500;
export const MIGRATION_READINESS_MAX_BACKOFF_MS = 4_000;
export const DATABASE_READINESS_READY_TTL_MS = 5_000;

export type MigrationReadinessRetryEvent = {
  attempt: number;
  maxAttempts: number;
  name: string;
  code: string;
};

export type MigrationReadinessOptions = {
  maxAttempts?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onRetry?: (event: MigrationReadinessRetryEvent) => void;
};

export type DatabaseReadinessGateOptions = MigrationReadinessOptions & {
  readyTtlMs?: number;
  now?: () => number;
};

function safeErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name : "UNKNOWN";
  return /^[A-Za-z0-9_.-]{1,64}$/u.test(name) ? name : "UNKNOWN";
}

function safeErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "UNKNOWN";
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") {
    return "UNKNOWN";
  }
  return /^[A-Z0-9_]{1,64}$/u.test(code.toUpperCase()) ? code.toUpperCase() : "UNKNOWN";
}

function isTransientDatabaseNotReady(error: unknown): boolean {
  return TRANSIENT_DATABASE_NOT_READY_CODES.has(safeErrorCode(error));
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitForMigrationDatabaseReady(
  readinessQuery: () => Promise<unknown>,
  options: MigrationReadinessOptions = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? MIGRATION_READINESS_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? MIGRATION_READINESS_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? MIGRATION_READINESS_MAX_BACKOFF_MS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(backoffMs) || backoffMs < 0) {
    throw new Error("backoffMs must be non-negative");
  }
  if (!Number.isFinite(maxBackoffMs) || maxBackoffMs < 0) {
    throw new Error("maxBackoffMs must be non-negative");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await readinessQuery();
      return;
    } catch (error) {
      const code = safeErrorCode(error);
      if (!isTransientDatabaseNotReady(error) || attempt === maxAttempts) {
        throw error;
      }
      options.onRetry?.({
        attempt,
        maxAttempts,
        name: safeErrorName(error),
        code,
      });
      const delayMs = Math.min(
        backoffMs * 2 ** (attempt - 1),
        maxBackoffMs,
      );
      await (options.sleep ?? defaultSleep)(delayMs);
    }
  }
}

export function createDatabaseReadinessGate(
  readinessQuery: () => Promise<unknown>,
  options: DatabaseReadinessGateOptions = {},
): () => Promise<void> {
  const readyTtlMs = options.readyTtlMs ?? DATABASE_READINESS_READY_TTL_MS;
  if (!Number.isFinite(readyTtlMs) || readyTtlMs < 0) {
    throw new Error("readyTtlMs must be non-negative");
  }

  const now = options.now ?? Date.now;
  const retryOptions: MigrationReadinessOptions = {
    maxAttempts: options.maxAttempts,
    backoffMs: options.backoffMs,
    maxBackoffMs: options.maxBackoffMs,
    sleep: options.sleep,
    onRetry: options.onRetry,
  };
  let readyUntil = 0;
  let inFlight: Promise<void> | undefined;

  return async (): Promise<void> => {
    if (now() < readyUntil) {
      return;
    }
    if (inFlight) {
      await inFlight;
      return;
    }

    const operation = waitForMigrationDatabaseReady(readinessQuery, retryOptions)
      .then(() => {
        readyUntil = now() + readyTtlMs;
      });
    inFlight = operation;

    try {
      await operation;
    } finally {
      if (inFlight === operation) {
        inFlight = undefined;
      }
    }
  };
}
