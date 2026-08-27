import assert from "node:assert/strict";
import test from "node:test";
import { RETENTION_BATCH_SIZE, runBoundedRetention } from "../src/domains/retention/retention-policy.js";
import { deleteExpiredMcpIdempotencyBatch } from "../src/mcp/server/idempotency-retention.js";

test("MCP idempotency retention uses fixed bounded batches and surfaces failed batches", async () => {
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
      throw new Error("MCP idempotency batch failed");
    }),
    /MCP idempotency batch failed/,
  );
  assert.equal(failedBatchCalls, 1);
});

test("MCP idempotency retention rejects invalid batch limits before accessing the database", async () => {
  await assert.rejects(
    deleteExpiredMcpIdempotencyBatch(undefined as never, new Date("2026-08-01T00:00:00.000Z"), 0),
    /limit must be a positive integer no greater than 500/,
  );
});
