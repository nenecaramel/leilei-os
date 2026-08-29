import assert from "node:assert/strict";
import test from "node:test";
import {
  SENTINEL_WAKE_RECOVERY_TIMEOUT_MS,
  createSentinelScheduler,
  type SentinelSchedulerRepository,
} from "../src/domains/sentinel/sentinel-scheduler.js";

function createdWake() {
  return {
    outcome: "created" as const,
    wake: { state: "bridge_enqueued" as const },
    bridge: { status: "pending" as const },
  };
}

test("scheduler admits only one due enabled idle wake across duplicate scans", async () => {
  let active = false;
  let createCalls = 0;
  const repository: SentinelSchedulerRepository = {
    async createDueWake() {
      if (active) return { outcome: "not_found" };
      active = true;
      createCalls += 1;
      return createdWake() as never;
    },
    async markStaleWakeRuns() {
      return 0;
    },
  };
  const scheduler = createSentinelScheduler({ repository, createWakeId: () => "wake-1" });

  assert.equal(await scheduler.runOnce(new Date("2026-08-30T00:00:00.000Z")), 1);
  assert.equal(await scheduler.runOnce(new Date("2026-08-30T00:00:01.000Z")), 0);
  assert.equal(createCalls, 1);
});

test("scheduler leaves a pending active wake alone when no listener is online", async () => {
  let createCalls = 0;
  const repository: SentinelSchedulerRepository = {
    async createDueWake() {
      createCalls += 1;
      return { outcome: "idempotent", wake: { state: "bridge_enqueued" }, bridge: { status: "pending" } } as never;
    },
    async markStaleWakeRuns() {
      return 0;
    },
  };
  const scheduler = createSentinelScheduler({ repository, createWakeId: () => "wake-1" });

  assert.equal(await scheduler.runOnce(), 0);
  assert.equal(createCalls, 1);
});

test("claimed wakes older than the recovery timeout are projected without a successor", async () => {
  let staleCalls = 0;
  let createCalls = 0;
  const repository: SentinelSchedulerRepository = {
    async createDueWake() {
      createCalls += 1;
      return { outcome: "not_found" };
    },
    async markStaleWakeRuns(now, timeoutMs) {
      staleCalls += 1;
      assert.equal(timeoutMs, SENTINEL_WAKE_RECOVERY_TIMEOUT_MS);
      assert.ok(now instanceof Date);
      return 1;
    },
  };
  const scheduler = createSentinelScheduler({ repository });

  assert.equal(await scheduler.runOnce(new Date("2026-08-30T00:00:00.000Z")), 0);
  assert.equal(staleCalls, 1);
  assert.equal(createCalls, 1);
});

test("scheduler start/stop/drain uses one bounded polling handle and admits an immediate scan", async () => {
  const scheduled: Array<() => void> = [];
  let starts = 0;
  let clears = 0;
  const repository: SentinelSchedulerRepository = {
    async createDueWake() {
      starts += 1;
      return { outcome: "not_found" };
    },
    async markStaleWakeRuns() {
      return 0;
    },
  };
  const scheduler = createSentinelScheduler({
    repository,
    schedule: (callback, milliseconds) => {
      assert.equal(milliseconds, 30_000);
      scheduled.push(callback);
      return { unref() {} };
    },
    clearSchedule: () => { clears += 1; },
  });

  scheduler.start();
  await scheduler.drain();
  assert.equal(starts, 1);
  scheduled[0]?.();
  await scheduler.drain();
  assert.equal(starts, 2);
  scheduler.stopScheduling();
  scheduler.stopScheduling();
  assert.equal(clears, 1);
});

