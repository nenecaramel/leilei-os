import assert from "node:assert/strict";
import test from "node:test";
import * as readiness from "../src/database/migration-readiness.js";

const transientError = () => Object.assign(new Error("database is starting"), {
  name: "PostgresError",
  code: "57P03",
});

const transientConnectionError = (code: string) => Object.assign(new Error("transient connection failure"), {
  name: "Error",
  code,
});

test("readiness retries transient 57P03 and proceeds when PostgreSQL accepts a query", async () => {
  let attempts = 0;
  const retryEvents: unknown[] = [];

  await readiness.waitForMigrationDatabaseReady(async () => {
    attempts += 1;
    if (attempts < 3) throw transientError();
  }, {
    maxAttempts: 3,
    backoffMs: 0,
    sleep: async () => undefined,
    onRetry: (event) => retryEvents.push(event),
  });

  assert.equal(attempts, 3);
  assert.deepEqual(retryEvents, [
    { attempt: 1, maxAttempts: 3, name: "PostgresError", code: "57P03" },
    { attempt: 2, maxAttempts: 3, name: "PostgresError", code: "57P03" },
  ]);
});

test("readiness retries transient connection errors needed for serverless PostgreSQL wake", async () => {
  const retryableCodes = [
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EAI_AGAIN",
    "CONNECT_TIMEOUT",
    "CONNECTION_CLOSED",
  ];

  for (const code of retryableCodes) {
    let attempts = 0;
    await readiness.waitForMigrationDatabaseReady(async () => {
      attempts += 1;
      if (attempts === 1) throw transientConnectionError(code);
    }, {
      maxAttempts: 2,
      backoffMs: 0,
      sleep: async () => undefined,
    });
    assert.equal(attempts, 2, `expected ${code} to retry exactly once`);
  }
});

test("persistent 57P03 exhausts bounded readiness retries", async () => {
  let attempts = 0;
  await assert.rejects(
    readiness.waitForMigrationDatabaseReady(async () => {
      attempts += 1;
      throw transientError();
    }, { maxAttempts: 3, backoffMs: 0, sleep: async () => undefined }),
    (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "57P03",
  );
  assert.equal(attempts, 3);
});

test("non-transient readiness errors fail immediately without retry", async () => {
  let attempts = 0;
  const authenticationError = Object.assign(new Error("private authentication detail"), {
    name: "PostgresError",
    code: "28P01",
  });
  await assert.rejects(
    readiness.waitForMigrationDatabaseReady(async () => {
      attempts += 1;
      throw authenticationError;
    }, { maxAttempts: 4, backoffMs: 0, sleep: async () => undefined }),
    authenticationError,
  );
  assert.equal(attempts, 1);
});

test("readiness exponential backoff is capped so wake waits remain bounded", async () => {
  const sleepDurations: number[] = [];
  let attempts = 0;

  await readiness.waitForMigrationDatabaseReady(async () => {
    attempts += 1;
    if (attempts < 4) throw transientError();
  }, {
    maxAttempts: 4,
    backoffMs: 100,
    maxBackoffMs: 150,
    sleep: async (milliseconds) => {
      sleepDurations.push(milliseconds);
    },
  } as Parameters<typeof readiness.waitForMigrationDatabaseReady>[1] & { maxBackoffMs: number });

  assert.deepEqual(sleepDurations, [100, 150, 150]);
});

test("runtime readiness retry budget spans at least 90 seconds without changing migration retries", () => {
  let retryDelayMs = 0;
  for (
    let attempt = 1;
    attempt < readiness.RUNTIME_DATABASE_READINESS_MAX_ATTEMPTS;
    attempt += 1
  ) {
    retryDelayMs += Math.min(
      readiness.MIGRATION_READINESS_BACKOFF_MS * 2 ** (attempt - 1),
      readiness.MIGRATION_READINESS_MAX_BACKOFF_MS,
    );
  }

  assert.equal(readiness.MIGRATION_READINESS_MAX_ATTEMPTS, 8);
  assert.ok(
    retryDelayMs >= 90_000,
    `expected runtime readiness retry delay >= 90s, got ${retryDelayMs}ms`,
  );
});

test("retry metadata contains only safe stage fields and no error text", async () => {
  const retryEvents: Array<Record<string, unknown>> = [];
  let attempts = 0;
  await readiness.waitForMigrationDatabaseReady(async () => {
    attempts += 1;
    if (attempts === 1) throw transientError();
  }, {
    maxAttempts: 2,
    backoffMs: 0,
    sleep: async () => undefined,
    onRetry: (event) => retryEvents.push(event),
  });
  assert.deepEqual(Object.keys(retryEvents[0] ?? {}).sort(), ["attempt", "code", "maxAttempts", "name"]);
  assert.equal("message" in (retryEvents[0] ?? {}), false);
  assert.equal("stack" in (retryEvents[0] ?? {}), false);
});

type CreateDatabaseReadinessGate = (
  readinessQuery: () => Promise<unknown>,
  options?: {
    maxAttempts?: number;
    backoffMs?: number;
    maxBackoffMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    readyTtlMs?: number;
    now?: () => number;
  },
) => () => Promise<void>;

function getCreateDatabaseReadinessGate(): CreateDatabaseReadinessGate | undefined {
  return (readiness as unknown as {
    createDatabaseReadinessGate?: CreateDatabaseReadinessGate;
  }).createDatabaseReadinessGate;
}

test("runtime readiness gate coalesces concurrent cold-start wake attempts", async () => {
  const createGate = getCreateDatabaseReadinessGate();
  assert.equal(typeof createGate, "function");
  if (!createGate) return;

  let attempts = 0;
  let releaseProbe!: () => void;
  const probeCanFinish = new Promise<void>((resolve) => {
    releaseProbe = resolve;
  });
  const gate = createGate(async () => {
    attempts += 1;
    await probeCanFinish;
  }, {
    maxAttempts: 1,
    readyTtlMs: 0,
  });

  const first = gate();
  const second = gate();
  await Promise.resolve();
  assert.equal(attempts, 1);
  releaseProbe();
  await Promise.all([first, second]);
  assert.equal(attempts, 1);
});

test("runtime readiness gate briefly caches a successful probe then probes again", async () => {
  const createGate = getCreateDatabaseReadinessGate();
  assert.equal(typeof createGate, "function");
  if (!createGate) return;

  let now = 1_000;
  let attempts = 0;
  const gate = createGate(async () => {
    attempts += 1;
  }, {
    maxAttempts: 1,
    readyTtlMs: 5_000,
    now: () => now,
  });

  await gate();
  await gate();
  assert.equal(attempts, 1);

  now += 5_001;
  await gate();
  assert.equal(attempts, 2);
});
