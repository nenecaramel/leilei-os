import assert from "node:assert/strict";
import test from "node:test";
import {
  BackgroundOpportunityPolicy,
} from "../src/domains/runtime/background-opportunity-policy.js";
import {
  createBackgroundMaintenancePulse,
} from "../src/domains/runtime/background-maintenance-pulse.js";

test("maintenance pulse discovers bounded subject owners and schedules only policy-selected maintenance", async () => {
  const calls: unknown[] = [];
  const pulse = createBackgroundMaintenancePulse({
    source: {
      async listUserIds(input) {
        assert.deepEqual(input, {
          subjectId: "G",
          limit: 2,
        });
        return ["u1", "u2"];
      },
    },
    maintenance: {
      schedule(input) {
        calls.push(input);
      },
    },
    policy: new BackgroundOpportunityPolicy({
      maintenancePulseIntervalMs: 60_000,
      decayEnabled: false,
      topicResurfaceMinIntervalMs: null,
    }),
    subjectId: "G",
    config: {
      userLimit: 2,
    },
  });

  assert.equal(await pulse.runNow(), 2);
  assert.deepEqual(calls, [
    {
      userId: "u1",
      kinds: [
        "thought_evolution",
        "drive_evolution",
        "topic_lifecycle",
      ],
    },
    {
      userId: "u2",
      kinds: [
        "thought_evolution",
        "drive_evolution",
        "topic_lifecycle",
      ],
    },
  ]);
});

test("maintenance pulse includes Decay only when an explicit decay policy is enabled", async () => {
  const calls: unknown[] = [];
  const pulse = createBackgroundMaintenancePulse({
    source: {
      async listUserIds() {
        return ["u1"];
      },
    },
    maintenance: {
      schedule(input) {
        calls.push(input);
      },
    },
    policy: new BackgroundOpportunityPolicy({
      maintenancePulseIntervalMs: 60_000,
      decayEnabled: true,
      topicResurfaceMinIntervalMs: null,
    }),
    subjectId: "G",
    config: {
      userLimit: 4,
    },
  });

  await pulse.runNow();
  assert.deepEqual(calls, [{
    userId: "u1",
    kinds: [
      "decay",
      "thought_evolution",
      "drive_evolution",
      "topic_lifecycle",
    ],
  }]);
});

test("maintenance pulse owns one coarse timer, runs immediately on start, and drains in-flight discovery", async () => {
  let callback: (() => void) | null = null;
  let clearCalls = 0;
  let sourceCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const pulse = createBackgroundMaintenancePulse({
    source: {
      async listUserIds() {
        sourceCalls += 1;
        if (sourceCalls === 1) await gate;
        return [];
      },
    },
    maintenance: {
      schedule() {},
    },
    policy: new BackgroundOpportunityPolicy({
      maintenancePulseIntervalMs: 3_600_000,
      decayEnabled: false,
      topicResurfaceMinIntervalMs: null,
    }),
    subjectId: "G",
    config: {
      userLimit: 64,
    },
    schedule(next, milliseconds) {
      assert.equal(milliseconds, 3_600_000);
      callback = next;
      return { unref() {} };
    },
    clearSchedule() {
      clearCalls += 1;
    },
  });

  pulse.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sourceCalls, 1);
  assert.ok(callback);

  callback?.();
  assert.equal(sourceCalls, 1, "overlapping pulses coalesce");

  release();
  await pulse.drain();
  callback?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sourceCalls, 2);

  pulse.stopScheduling();
  assert.equal(clearCalls, 1);
  assert.equal(await pulse.runNow(), 0);
});


test("maintenance pulse shares cadence with an optional Proactivity producer without making it part of Subject maintenance", async () => {
  const calls: string[] = [];
  const pulse = createBackgroundMaintenancePulse({
    source: {
      async listUserIds() {
        return ["u1"];
      },
    },
    maintenance: {
      schedule(input) {
        calls.push("maintenance:" + input.kinds?.join(","));
      },
    },
    policy: new BackgroundOpportunityPolicy({
      maintenancePulseIntervalMs: 60_000,
      decayEnabled: false,
      proactivityWakeEnabled: true,
      topicResurfaceMinIntervalMs: null,
    }),
    subjectId: "G",
    config: { userLimit: 4 },
    async afterCycle() {
      calls.push("proactivity");
    },
  });

  await pulse.runNow();
  assert.deepEqual(calls, [
    "maintenance:thought_evolution,drive_evolution,topic_lifecycle",
    "proactivity",
  ]);
});
