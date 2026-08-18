const TRANSIENT_DATABASE_NOT_READY = "57P03";

export const MIGRATION_READINESS_MAX_ATTEMPTS = 4;
export const MIGRATION_READINESS_BACKOFF_MS = 250;

export type MigrationReadinessRetryEvent = {
  attempt: number;
  maxAttempts: number;
  name: string;
  code: string;
};

export type MigrationReadinessOptions = {
  maxAttempts?: number;
  backoffMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onRetry?: (event: MigrationReadinessRetryEvent) => void;
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

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitForMigrationDatabaseReady(
  readinessQuery: () => Promise<unknown>,
  options: MigrationReadinessOptions = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? MIGRATION_READINESS_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? MIGRATION_READINESS_BACKOFF_MS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(backoffMs) || backoffMs < 0) {
    throw new Error("backoffMs must be non-negative");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await readinessQuery();
      return;
    } catch (error) {
      const code = safeErrorCode(error);
      if (code !== TRANSIENT_DATABASE_NOT_READY || attempt === maxAttempts) {
        throw error;
      }
      options.onRetry?.({
        attempt,
        maxAttempts,
        name: safeErrorName(error),
        code,
      });
      await (options.sleep ?? defaultSleep)(backoffMs * 2 ** (attempt - 1));
    }
  }
}
