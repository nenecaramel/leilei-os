import assert from "node:assert/strict";
import test from "node:test";
import { createRetentionCoordinator } from "../src/domains/retention/retention-coordinator.js";

function fakeScheduler() {
  let callback: (() => void) | undefined;
  let clearCalls = 0;
  let unrefCalls = 0;
  return {
    schedule(next: () => void, milliseconds: number) {
      assert.equal(milliseconds, 1_000);
      callback = next;
      return { unref: () => { unrefCalls += 1; } };
    },
    clear: () => { clearCalls += 1; },
    fire: () => callback?.(),
    get clearCalls() { return clearCalls; },
    get unrefCalls() { return unrefCalls; },
  };
}

test("start queues one immediate run and one interval", async () => {
  const scheduler = fakeScheduler();
  let calls = 0;
  const coordinator = createRetentionCoordinator({
    intervalMs: 1_000,
    schedule: scheduler.schedule,
    clearSchedule: scheduler.clear,
    policies: [{
      policy: "mcp_write_idempotency",
      retentionMs: 1_000,
      deleteBatch: async () => { calls += 1; return 0; },
    }],
  });
  coordinator.start();
  await coordinator.drain();
  assert.equal(calls, 1);
  assert.equal(scheduler.unrefCalls, 1);
  scheduler.fire();
  await coordinator.drain();
  assert.equal(calls, 2);
});

test("repeated triggers share one in-flight run", async () => {
  const scheduler = fakeScheduler();
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const coordinator = createRetentionCoordinator({
    intervalMs: 1_000,
    schedule: scheduler.schedule,
    clearSchedule: scheduler.clear,
    policies: [{
      policy: "data_import_runs",
      retentionMs: 1_000,
      deleteBatch: async () => { calls += 1; await blocker; return 0; },
    }],
  });
  const first = coordinator.runNow();
  const second = coordinator.runNow();
  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  release();
  await first;
});

test("failed policy is retried on the next cadence and does not spin", async () => {
  const scheduler = fakeScheduler();
  let calls = 0;
  const coordinator = createRetentionCoordinator({
    intervalMs: 1_000,
    schedule: scheduler.schedule,
    clearSchedule: scheduler.clear,
    policies: [{
      policy: "mcp_write_idempotency",
      retentionMs: 1_000,
      deleteBatch: async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary");
        return 0;
      },
    }],
  });
  coordinator.start();
  await coordinator.drain();
  assert.equal(calls, 1);
  scheduler.fire();
  await coordinator.drain();
  assert.equal(calls, 2);
});

test("stopScheduling prevents a timer callback from admitting new work", async () => {
  const scheduler = fakeScheduler();
  let calls = 0;
  const coordinator = createRetentionCoordinator({
    intervalMs: 1_000,
    schedule: scheduler.schedule,
    clearSchedule: scheduler.clear,
    policies: [{
      policy: "data_import_runs",
      retentionMs: 1_000,
      deleteBatch: async () => { calls += 1; return 0; },
    }],
  });
  coordinator.start();
  await coordinator.drain();
  coordinator.stopScheduling();
  coordinator.stopScheduling();
  scheduler.fire();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(scheduler.clearCalls, 1);
  await coordinator.runNow();
  assert.equal(calls, 1);
});

test("drain waits for current work without starting a new run", async () => {
  const scheduler = fakeScheduler();
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const coordinator = createRetentionCoordinator({
    intervalMs: 1_000,
    schedule: scheduler.schedule,
    clearSchedule: scheduler.clear,
    policies: [{
      policy: "mcp_write_idempotency",
      retentionMs: 1_000,
      deleteBatch: async () => { calls += 1; await blocker; return 0; },
    }],
  });
  const running = coordinator.runNow();
  const draining = coordinator.drain();
  let finished = false;
  void draining.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(calls, 1);
  release();
  await running;
  await draining;
  assert.equal(finished, true);
  assert.equal(calls, 1);
});

test("each policy receives its retention cutoff and emits its own completion event", async () => {
  const cutoffs: Array<{ policy: string; cutoff: Date; limit: number }> = [];
  const events: unknown[] = [];
  const coordinator = createRetentionCoordinator({
    intervalMs: 1_000,
    now: () => 1_000_000,
    observe: (event) => { events.push(event); },
    policies: [
      {
        policy: "mcp_write_idempotency",
        retentionMs: 1_000,
        deleteBatch: async (cutoff, limit) => {
          cutoffs.push({ policy: "mcp_write_idempotency", cutoff, limit });
          return 3;
        },
      },
      {
        policy: "data_import_runs",
        retentionMs: 10_000,
        deleteBatch: async (cutoff, limit) => {
          cutoffs.push({ policy: "data_import_runs", cutoff, limit });
          return 0;
        },
      },
    ],
  });

  await coordinator.runNow();

  assert.deepEqual(cutoffs.map(({ policy, cutoff, limit }) => ({
    policy,
    cutoff: cutoff.getTime(),
    limit,
  })), [
    { policy: "mcp_write_idempotency", cutoff: 999_000, limit: 500 },
    { policy: "data_import_runs", cutoff: 990_000, limit: 500 },
  ]);
  assert.deepEqual(events, [
    {
      name: "mcp_idempotency_cleanup_completed",
      policy: "mcp_write_idempotency",
      deletedRows: 3,
      batches: 1,
      capped: false,
      durationMs: 0,
    },
    {
      name: "data_import_runs_cleanup_completed",
      policy: "data_import_runs",
      deletedRows: 0,
      batches: 1,
      capped: false,
      durationMs: 0,
    },
  ]);
});

test("a failed policy emits failure and does not prevent later policy work", async () => {
  const events: unknown[] = [];
  let laterCalls = 0;
  const coordinator = createRetentionCoordinator({
    intervalMs: 1_000,
    now: () => 4_000,
    observe: (event) => { events.push(event); },
    policies: [
      {
        policy: "mcp_write_idempotency",
        retentionMs: 1_000,
        deleteBatch: async () => { throw new Error("database unavailable"); },
      },
      {
        policy: "data_import_runs",
        retentionMs: 2_000,
        deleteBatch: async () => { laterCalls += 1; return 0; },
      },
    ],
  });

  await coordinator.runNow();

  assert.equal(laterCalls, 1);
  assert.deepEqual(events, [
    {
      name: "mcp_idempotency_cleanup_failed",
      policy: "mcp_write_idempotency",
      batches: 1,
      durationMs: 0,
    },
    {
      name: "data_import_runs_cleanup_completed",
      policy: "data_import_runs",
      deletedRows: 0,
      batches: 1,
      capped: false,
      durationMs: 0,
    },
  ]);
});

test("a throwing observer cannot stop later policy retention", async () => {
  let deleteCalls = 0;
  const coordinator = createRetentionCoordinator({
    intervalMs: 1_000,
    observe: () => { throw new Error("observer unavailable"); },
    policies: [
      {
        policy: "mcp_write_idempotency",
        retentionMs: 1_000,
        deleteBatch: async () => { deleteCalls += 1; return 0; },
      },
      {
        policy: "data_import_runs",
        retentionMs: 1_000,
        deleteBatch: async () => { deleteCalls += 1; return 0; },
      },
    ],
  });

  await coordinator.runNow();

  assert.equal(deleteCalls, 2);
});


test("background model operational retention emits its dedicated completion event", async () => {
  const events: unknown[] = [];
  const cutoffs: number[] = [];
  const coordinator = createRetentionCoordinator({
    intervalMs: 1_000,
    now: () => 10_000,
    observe: (event) => { events.push(event); },
    policies: [{
      policy: "native_live_background_model_jobs",
      retentionMs: 7_000,
      deleteBatch: async (cutoff) => {
        cutoffs.push(cutoff.getTime());
        return 2;
      },
    }],
  });

  await coordinator.runNow();

  assert.deepEqual(cutoffs, [3_000]);
  assert.deepEqual(events, [{
    name: "native_live_background_model_jobs_cleanup_completed",
    policy: "native_live_background_model_jobs",
    deletedRows: 2,
    batches: 1,
    capped: false,
    durationMs: 0,
  }]);
});
