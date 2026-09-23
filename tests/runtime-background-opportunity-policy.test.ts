import assert from "node:assert/strict";
import test from "node:test";
import {
  BackgroundOpportunityPolicy,
} from "../src/domains/runtime/background-opportunity-policy.js";

test("background opportunity policy keeps post-turn consolidation separate from time maintenance", () => {
  const policy = new BackgroundOpportunityPolicy({
    maintenancePulseIntervalMs: 3_600_000,
    decayEnabled: false,
    topicResurfaceMinIntervalMs: 90_000,
  });

  assert.deepEqual(
    policy.decide({ opportunity: "post_turn" }).targets.map(
      (target) => target.kind,
    ),
    ["distillation"],
  );
  assert.deepEqual(
    policy.decide({ opportunity: "maintenance_pulse" }).targets.map(
      (target) => target.kind,
    ),
    [
      "thought_evolution",
      "drive_evolution",
      "topic_lifecycle",
    ],
  );
  assert.deepEqual(
    policy.decide({ opportunity: "mac_idle" }).targets.map(
      (target) => target.kind,
    ),
    ["topic_resurface"],
  );
  assert.equal(policy.cadenceMs("post_turn"), null);
  assert.equal(policy.cadenceMs("maintenance_pulse"), 3_600_000);
  assert.equal(policy.cadenceMs("mac_idle"), 90_000);
});

test("Decay is opt-in and Breath is not a schedulable background target", () => {
  const policy = new BackgroundOpportunityPolicy({
    maintenancePulseIntervalMs: 3_600_000,
    decayEnabled: true,
    topicResurfaceMinIntervalMs: null,
  });

  const kinds = [
    ...policy.decide({ opportunity: "post_turn" }).targets,
    ...policy.decide({ opportunity: "maintenance_pulse" }).targets,
    ...policy.decide({ opportunity: "mac_idle" }).targets,
  ].map((target) => target.kind);

  assert.equal(kinds.includes("decay"), true);
  assert.equal(kinds.includes("breath" as never), false);
  assert.equal(kinds.includes("topic_resurface"), false);
});


test("background opportunity policy rejects invalid source cadence", () => {
  assert.throws(
    () => new BackgroundOpportunityPolicy({
      maintenancePulseIntervalMs: 0,
      decayEnabled: false,
      topicResurfaceMinIntervalMs: null,
    }),
    /maintenance_pulse cadence/,
  );
});
