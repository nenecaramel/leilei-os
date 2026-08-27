import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RETENTION_BATCH_SIZE, runBoundedRetention } from "../src/domains/retention/retention-policy.js";
import { deleteExpiredDataImportRunsBatch } from "../src/domains/import/import-retention.js";

test("data import retention uses fixed bounded batches and surfaces failed batches", async () => {
  const limits: number[] = [];
  const capped = await runBoundedRetention(async (limit) => {
    limits.push(limit);
    return RETENTION_BATCH_SIZE;
  });

  assert.deepEqual(limits, Array.from({ length: 20 }, () => RETENTION_BATCH_SIZE));
  assert.deepEqual(capped, { deletedRows: 10_000, batches: 20, capped: true });

  let failedBatchCalls = 0;
  await assert.rejects(
    runBoundedRetention(async (limit) => {
      assert.equal(limit, RETENTION_BATCH_SIZE);
      failedBatchCalls += 1;
      throw new Error("data import batch failed");
    }),
    /data import batch failed/,
  );
  assert.equal(failedBatchCalls, 1);
});

test("data import retention rejects invalid batch limits before accessing the database", async () => {
  await assert.rejects(
    deleteExpiredDataImportRunsBatch(undefined as never, new Date("2026-08-01T00:00:00.000Z"), 0),
    /limit must be a positive integer no greater than 500/,
  );
});

test("data import retention uses the shared database and one bounded transaction", async () => {
  const source = await readFile(new URL("../src/domains/import/import-retention.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createDatabase\s*\(|postgres\s*\(/);
  assert.match(source, /database\.transaction\(/);
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /LIMIT \$\{limit\}/);
  assert.match(source, /created_at < \$\{cutoff\.toISOString\(\)\}/);
  assert.match(source, /ORDER BY created_at ASC, id ASC/);
});
