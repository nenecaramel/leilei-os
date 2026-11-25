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

function service(maintenanceCalls: unknown[], throws = false) {
  return new CompanionBackgroundOpportunityService(
    {
      schedule(input: unknown) {
        if (throws) throw new Error("maintenance unavailable");
        maintenanceCalls.push(input);
      },
    } as never,
    { decide: () => decayPlan },
  );
}

for (const reason of ["due", "startup"] as const) {
  test(`${reason} companion opportunity schedules maintenance only`, async () => {
    const calls: unknown[] = [];
    assert.deepEqual(await service(calls).offer({ userId: " user-1 ", reason }), {
      reason,
      maintenanceKinds: ["decay"],
      failures: [],
    });
    assert.deepEqual(calls, [{ userId: "user-1", kinds: ["decay"] }]);
  });
}

test("a maintenance failure is reported, not thrown", async () => {
  assert.deepEqual(await service([], true).offer({ userId: "user-1", reason: "due" }), {
    reason: "due",
    maintenanceKinds: ["decay"],
    failures: ["subject_state"],
  });
});

test("dirty companion opportunity is a no-op", async () => {
  const calls: unknown[] = [];
  assert.deepEqual(await service(calls).offer({ userId: "user-1", reason: "dirty" }), {
    reason: "dirty",
    maintenanceKinds: [],
    failures: [],
  });
  assert.deepEqual(calls, []);
});

test("a blank user is refused", async () => {
  await assert.rejects(service([]).offer({ userId: "  ", reason: "due" }), /must not be blank/u);
});
