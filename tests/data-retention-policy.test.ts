import assert from "node:assert/strict";
import test from "node:test";
import { runBoundedRetention } from "../src/domains/retention/retention-policy.js";

test("bounded runner continues after full batches and stops on a short batch", async () => {
  const limits: number[] = [];
  const results = [500, 500, 17];
  const result = await runBoundedRetention(async (limit) => {
    limits.push(limit);
    return results.shift()!;
  });
  assert.deepEqual(limits, [500, 500, 500]);
  assert.deepEqual(result, { deletedRows: 1017, batches: 3, capped: false });
});

test("bounded runner stops exactly at twenty full batches", async () => {
  let calls = 0;
  const result = await runBoundedRetention(async (limit) => {
    calls += 1;
    assert.equal(limit, 500);
    return 500;
  });
  assert.equal(calls, 20);
  assert.deepEqual(result, { deletedRows: 10_000, batches: 20, capped: true });
});

test("bounded runner propagates a failed batch without an unbounded retry", async () => {
  let calls = 0;
  await assert.rejects(
    runBoundedRetention(async () => {
      calls += 1;
      throw new Error("batch failed");
    }),
    /batch failed/,
  );
  assert.equal(calls, 1);
});
