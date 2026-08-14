import assert from "node:assert/strict";
import test from "node:test";
import { waitForMigrationDatabaseReady } from "../src/database/migration-readiness.js";

const transientError = () => Object.assign(new Error("database is starting"), {
  name: "PostgresError",
  code: "57P03",
});

test("readiness retries transient 57P03 and proceeds when PostgreSQL accepts a query", async () => {
  let attempts = 0;
  const retryEvents: unknown[] = [];

  await waitForMigrationDatabaseReady(async () => {
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

test("persistent 57P03 exhausts bounded readiness retries", async () => {
  let attempts = 0;
  await assert.rejects(
    waitForMigrationDatabaseReady(async () => {
      attempts += 1;
      throw transientError();
    }, { maxAttempts: 3, backoffMs: 0, sleep: async () => undefined }),
    (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "57P03",
  );
  assert.equal(attempts, 3);
});

test("non-57P03 readiness errors fail immediately without retry", async () => {
  let attempts = 0;
  const authenticationError = Object.assign(new Error("private authentication detail"), {
    name: "PostgresError",
    code: "28P01",
  });
  await assert.rejects(
    waitForMigrationDatabaseReady(async () => {
      attempts += 1;
      throw authenticationError;
    }, { maxAttempts: 4, backoffMs: 0, sleep: async () => undefined }),
    authenticationError,
  );
  assert.equal(attempts, 1);
});

test("retry metadata contains only safe stage fields and no error text", async () => {
  const retryEvents: Array<Record<string, unknown>> = [];
  let attempts = 0;
  await waitForMigrationDatabaseReady(async () => {
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
