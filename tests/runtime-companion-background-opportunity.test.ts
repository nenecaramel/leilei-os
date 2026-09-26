import assert from "node:assert/strict";
import test from "node:test";
import {
  CompanionBackgroundOpportunityService,
} from "../src/domains/runtime/companion-background-opportunity.js";

test("due companion opportunity schedules cadence work across maintenance, effect, proactivity and topic", async () => {
  const maintenanceCalls: unknown[] = [];
  const effectCalls: string[] = [];
  const proactivityCalls: string[] = [];
  const topicCalls: unknown[] = [];

  const service = new CompanionBackgroundOpportunityService(
    {
      schedule(input) {
        maintenanceCalls.push(input);
      },
    } as never,
    {
      decide() {
        return {
          opportunity: "companion_due" as const,
          targets: [
            {
              kind: "decay" as const,
              priority: "maintenance" as const,
              cost: 1,
            },
            {
              kind: "thought_evolution" as const,
              priority: "maintenance" as const,
              cost: 1,
            },
            {
              kind: "drive_evolution" as const,
              priority: "maintenance" as const,
              cost: 1,
            },
            {
              kind: "topic_lifecycle" as const,
              priority: "maintenance" as const,
              cost: 1,
            },
            {
              kind: "proactivity_wake" as const,
              priority: "reflection" as const,
              cost: 1,
            },
          ],
        };
      },
    },
    {
      scheduleUser(userId) {
        effectCalls.push(userId);
      },
    },
    {
      async scheduleUser(userId) {
        proactivityCalls.push(userId);
        return 1 as const;
      },
    },
    {
      async offer(input) {
        topicCalls.push(input);
        return {
          outcome: "attempted" as const,
          attemptedAt: "2026-09-25T00:00:00.000Z",
          result: { outcome: "idle" as const },
        };
      },
    },
  );

  const result = await service.offer({
    userId: " user-1 ",
    reason: "due",
  });

  assert.deepEqual(maintenanceCalls, [{
    userId: "user-1",
    kinds: [
      "decay",
      "thought_evolution",
      "drive_evolution",
      "topic_lifecycle",
    ],
  }]);
  assert.deepEqual(effectCalls, ["user-1"]);
  assert.deepEqual(proactivityCalls, ["user-1"]);
  assert.deepEqual(topicCalls, [{ userId: "user-1" }]);
  assert.deepEqual(result, {
    reason: "due",
    maintenanceKinds: [
      "decay",
      "thought_evolution",
      "drive_evolution",
      "topic_lifecycle",
    ],
    effectDeliveryScheduled: true,
    proactivityScheduled: true,
    topicResurfaceOffered: true,
    failures: [],
  });
});

test("dirty companion opportunity only offers effect recovery", async () => {
  const maintenanceCalls: unknown[] = [];
  const proactivityCalls: string[] = [];
  const topicCalls: unknown[] = [];
  const service = new CompanionBackgroundOpportunityService(
    {
      schedule(input) {
        maintenanceCalls.push(input);
      },
    } as never,
    {
      decide() {
        return {
          opportunity: "companion_due" as const,
          targets: [{
            kind: "thought_evolution" as const,
            priority: "maintenance" as const,
            cost: 1,
          }],
        };
      },
    },
    {
      scheduleUser() {
        throw new Error("effect unavailable");
      },
    },
    {
      async scheduleUser(userId) {
        proactivityCalls.push(userId);
        return 1 as const;
      },
    },
    {
      async offer(input) {
        topicCalls.push(input);
        return {
          outcome: "attempted" as const,
          attemptedAt: "2026-09-25T00:00:00.000Z",
          result: { outcome: "idle" as const },
        };
      },
    },
  );

  assert.deepEqual(await service.offer({
    userId: "user-1",
    reason: "dirty",
  }), {
    reason: "dirty",
    maintenanceKinds: [],
    effectDeliveryScheduled: false,
    proactivityScheduled: false,
    topicResurfaceOffered: false,
    failures: ["effect_delivery"],
  });
  assert.deepEqual(maintenanceCalls, []);
  assert.deepEqual(proactivityCalls, []);
  assert.deepEqual(topicCalls, []);
});

test("startup catch-up runs maintenance and proactivity without Topic resurfacing", async () => {
  const maintenanceCalls: unknown[] = [];
  const effectCalls: string[] = [];
  const proactivityCalls: string[] = [];
  const topicCalls: unknown[] = [];
  const service = new CompanionBackgroundOpportunityService(
    {
      schedule(input) {
        maintenanceCalls.push(input);
      },
    } as never,
    {
      decide() {
        return {
          opportunity: "companion_due" as const,
          targets: [{
            kind: "thought_evolution" as const,
            priority: "maintenance" as const,
            cost: 1,
          }],
        };
      },
    },
    {
      scheduleUser(userId) {
        effectCalls.push(userId);
      },
    },
    {
      async scheduleUser(userId) {
        proactivityCalls.push(userId);
        return 0 as const;
      },
    },
    {
      async offer(input) {
        topicCalls.push(input);
        return {
          outcome: "attempted" as const,
          attemptedAt: "2026-09-25T00:00:00.000Z",
          result: { outcome: "idle" as const },
        };
      },
    },
  );

  assert.deepEqual(await service.offer({
    userId: " user-1 ",
    reason: "startup",
  }), {
    reason: "startup",
    maintenanceKinds: ["thought_evolution"],
    effectDeliveryScheduled: true,
    proactivityScheduled: false,
    topicResurfaceOffered: false,
    failures: [],
  });
  assert.deepEqual(maintenanceCalls, [{
    userId: "user-1",
    kinds: ["thought_evolution"],
  }]);
  assert.deepEqual(effectCalls, ["user-1"]);
  assert.deepEqual(proactivityCalls, ["user-1"]);
  assert.deepEqual(topicCalls, []);
});
