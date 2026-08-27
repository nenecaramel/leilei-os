import assert from "node:assert/strict";
import test from "node:test";
import {
  McpIdempotencyCleanupCoordinator,
  type IdempotencyCleanupObserverEvent,
} from "../src/mcp/server/idempotency-retention.js";

test("idempotency cleanup runs once per interval with an exact cutoff", async () => {
  let now = Date.parse("2026-08-19T00:00:00.000Z");
  const cutoffs: Date[] = [];
  const events: IdempotencyCleanupObserverEvent[] = [];
  const coordinator = new McpIdempotencyCleanupCoordinator({
    now: () => now,
    retentionMs: 30 * 24 * 60 * 60 * 1_000,
    intervalMs: 24 * 60 * 60 * 1_000,
    cleanup: async (cutoff) => {
      cutoffs.push(cutoff);
      return 3;
    },
    observer: (event) => events.push(event),
  });

  await coordinator.maybeCleanup();
  await coordinator.maybeCleanup();
  assert.equal(cutoffs.length, 1);
  assert.equal(cutoffs[0]?.toISOString(), "2026-07-20T00:00:00.000Z");
  assert.equal(events[0]?.name, "mcp_idempotency_cleanup_completed");
  assert.equal(events[0]?.deletedRows, 3);

  now += 24 * 60 * 60 * 1_000;
  await coordinator.maybeCleanup();
  assert.equal(cutoffs.length, 2);
});

test("concurrent cleanup calls share one operation and failed attempts respect cadence", async () => {
  let now = 0;
  let calls = 0;
  let fail = true;
  const events: IdempotencyCleanupObserverEvent[] = [];
  const coordinator = new McpIdempotencyCleanupCoordinator({
    now: () => now,
    retentionMs: 1_000,
    intervalMs: 10_000,
    cleanup: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (fail) throw new Error("temporary");
      return 0;
    },
    observer: (event) => events.push(event),
  });

  await Promise.all([coordinator.maybeCleanup(), coordinator.maybeCleanup()]);
  assert.equal(calls, 1);
  assert.equal(events[0]?.name, "mcp_idempotency_cleanup_failed");

  fail = false;
  now = 9_999;
  await coordinator.maybeCleanup();
  assert.equal(calls, 1);

  now = 10_000;
  await coordinator.maybeCleanup();
  assert.equal(calls, 2);
  assert.equal(events[1]?.name, "mcp_idempotency_cleanup_completed");
});

test("successful cleanup attempts are also limited to one per interval", async () => {
  let now = 0;
  let calls = 0;
  const coordinator = new McpIdempotencyCleanupCoordinator({
    now: () => now,
    retentionMs: 1_000,
    intervalMs: 24 * 60 * 60 * 1_000,
    cleanup: async () => {
      calls += 1;
      return 0;
    },
  });
  await coordinator.maybeCleanup();
  now = 23 * 60 * 60 * 1_000;
  await coordinator.maybeCleanup();
  assert.equal(calls, 1);
  now = 24 * 60 * 60 * 1_000;
  await coordinator.maybeCleanup();
  assert.equal(calls, 2);
});

test("drain waits for only the current cleanup and starts no new work", async () => {
  let calls = 0;
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  const coordinator = new McpIdempotencyCleanupCoordinator({
    retentionMs: 1_000,
    intervalMs: 10_000,
    cleanup: async () => {
      calls += 1;
      await blocker;
      return 0;
    },
  });

  void coordinator.maybeCleanup();
  await Promise.resolve();
  let drained = false;
  const draining = coordinator.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  assert.equal(calls, 1);
  release();
  await draining;
  assert.equal(calls, 1);
  await coordinator.drain();
  assert.equal(calls, 1);
});
