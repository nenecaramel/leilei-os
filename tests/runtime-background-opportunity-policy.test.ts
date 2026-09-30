import assert from "node:assert/strict";
import test from "node:test";
import {
  BackgroundOpportunityPolicy,
  DEFAULT_BACKGROUND_TARGET_PLANS,
} from "../src/domains/runtime/background-opportunity-policy.js";

test("background opportunity policy owns only Companion timed maintenance", () => {
  const disabled = new BackgroundOpportunityPolicy({ decayEnabled: false });
  assert.deepEqual(disabled.decide().targets, []);

  const enabled = new BackgroundOpportunityPolicy({ decayEnabled: true });
  assert.deepEqual(
    enabled.decide().targets.map((target) => target.kind),
    ["decay"],
  );
  assert.equal(DEFAULT_BACKGROUND_TARGET_PLANS.decay.priority, "maintenance");
  assert.equal(
    DEFAULT_BACKGROUND_TARGET_PLANS.proactivityWake.priority,
    "reflection",
  );
});

test("Decay is opt-in; Breath, Proactivity and retired loops are not schedulable Companion targets", () => {
  const enabled = new BackgroundOpportunityPolicy({ decayEnabled: true });
  const kinds: string[] = enabled.decide().targets.map((target) => target.kind);

  for (const notScheduled of [
    "breath",
    "proactivity_wake",
    "effect_delivery",
    "distillation",
    "topic_resurface",
    "thought_evolution",
    "drive_evolution",
    "topic_lifecycle",
    "mind_retirement",
  ]) {
    assert.equal(kinds.includes(notScheduled), false, notScheduled);
  }
});
