import assert from "node:assert/strict";
import test from "node:test";
import {
  CompanionBackgroundOpportunityService,
} from "../src/domains/runtime/background/companion-background-opportunity.js";

const decayPlan = {
  opportunity: "companion_due" as const,
  targets: [{
    kind: "decay" as const,
    priority: "maintenance" as const,
    cost: 1,
  }],
};

function service(overrides: {
  maintenanceCalls?: unknown[];
  effectCalls?: string[];
  proactivityCalls?: string[];
  effectThrows?: boolean;
  proactivityScheduled?: 0 | 1;
} = {}) {
  return new CompanionBackgroundOpportunityService(
    {
      schedule(input) {
        overrides.maintenanceCalls?.push(input);
      },
    } as never,
    { decide: () => decayPlan },
    {
      scheduleUser(userId) {
        if (overrides.effectThrows) throw new Error("effect unavailable");
        overrides.effectCalls?.push(userId);
      },
    },
    {
      async scheduleUser(userId) {
        overrides.proactivityCalls?.push(userId);
        return overrides.proactivityScheduled ?? (1 as const);
      },
    },
  );
}

test("due companion opportunity schedules cadence work across maintenance, effect and proactivity", async () => {
  const maintenanceCalls: unknown[] = [];
  const effectCalls: string[] = [];
  const proactivityCalls: string[] = [];

  const result = await service({
    maintenanceCalls,
    effectCalls,
    proactivityCalls,
  }).offer({ userId: " user-1 ", reason: "due" });

  assert.deepEqual(maintenanceCalls, [{
    userId: "user-1",
    kinds: ["decay"],
  }]);
  assert.deepEqual(effectCalls, ["user-1"]);
  assert.deepEqual(proactivityCalls, ["user-1"]);
  assert.deepEqual(result, {
    reason: "due",
    maintenanceKinds: ["decay"],
    effectDeliveryScheduled: true,
    proactivityScheduled: true,
    failures: [],
  });
});

test("dirty companion opportunity only offers effect recovery", async () => {
  const maintenanceCalls: unknown[] = [];
  const proactivityCalls: string[] = [];

  assert.deepEqual(
    await service({
      maintenanceCalls,
      proactivityCalls,
      effectThrows: true,
    }).offer({ userId: "user-1", reason: "dirty" }),
    {
      reason: "dirty",
      maintenanceKinds: [],
      effectDeliveryScheduled: false,
      proactivityScheduled: false,
      failures: ["effect_delivery"],
    },
  );
  assert.deepEqual(maintenanceCalls, []);
  assert.deepEqual(proactivityCalls, []);
});

test("startup catch-up runs maintenance and proactivity", async () => {
  const maintenanceCalls: unknown[] = [];
  const effectCalls: string[] = [];
  const proactivityCalls: string[] = [];

  assert.deepEqual(
    await service({
      maintenanceCalls,
      effectCalls,
      proactivityCalls,
      proactivityScheduled: 0,
    }).offer({ userId: " user-1 ", reason: "startup" }),
    {
      reason: "startup",
      maintenanceKinds: ["decay"],
      effectDeliveryScheduled: true,
      proactivityScheduled: false,
      failures: [],
    },
  );
  assert.deepEqual(maintenanceCalls, [{
    userId: "user-1",
    kinds: ["decay"],
  }]);
  assert.deepEqual(effectCalls, ["user-1"]);
  assert.deepEqual(proactivityCalls, ["user-1"]);
});

test("dirty opportunity is a no-op when no effect producer is enabled", async () => {
  const idle = new CompanionBackgroundOpportunityService(
    {
      schedule() {
        throw new Error("dirty must not schedule maintenance");
      },
    } as never,
    {
      decide() {
        throw new Error("dirty must not consult timed policy");
      },
    },
    null,
    null,
  );

  assert.deepEqual(
    await idle.offer({ userId: "user-1", reason: "dirty" }),
    {
      reason: "dirty",
      maintenanceKinds: [],
      effectDeliveryScheduled: false,
      proactivityScheduled: false,
      failures: [],
    },
  );
});
