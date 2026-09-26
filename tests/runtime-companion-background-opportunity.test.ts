import assert from "node:assert/strict";
import test from "node:test";
import {
  CompanionBackgroundOpportunityService,
} from "../src/domains/runtime/companion-background-opportunity.js";

test("companion opportunity schedules one user across maintenance, effect, proactivity and topic work", async () => {
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
          opportunity: "maintenance_pulse" as const,
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
          outcome: "not_due" as const,
          lastAttemptAt: "2026-09-25T00:00:00.000Z",
          nextEligibleAt: "2026-09-25T01:00:00.000Z",
        };
      },
    },
  );

  const result = await service.offer({
    userId: " user-1 ",
    reason: "startup",
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
    reason: "startup",
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

test("companion opportunity is fail-soft per background subsystem", async () => {
  const service = new CompanionBackgroundOpportunityService(
    {
      schedule() {
        throw new Error("maintenance unavailable");
      },
    } as never,
    {
      decide() {
        return {
          opportunity: "maintenance_pulse" as const,
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
      async scheduleUser() {
        throw new Error("proactivity unavailable");
      },
    },
    {
      async offer() {
        throw new Error("topic unavailable");
      },
    },
  );

  assert.deepEqual(await service.offer({
    userId: "user-1",
    reason: "dirty",
  }), {
    reason: "dirty",
    maintenanceKinds: ["thought_evolution"],
    effectDeliveryScheduled: false,
    proactivityScheduled: false,
    topicResurfaceOffered: false,
    failures: [
      "subject_state",
      "effect_delivery",
      "proactivity",
      "topic_resurface",
    ],
  });
});
