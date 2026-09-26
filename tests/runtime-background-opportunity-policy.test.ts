import assert from "node:assert/strict";
import test from "node:test";
import {
  BackgroundOpportunityPolicy,
  DEFAULT_BACKGROUND_TARGET_PLANS,
} from "../src/domains/runtime/background-opportunity-policy.js";

test("background opportunity policy owns only Companion timed maintenance", () => {
  const policy = new BackgroundOpportunityPolicy({
    decayEnabled: false,
  });

  assert.deepEqual(
    policy.decide().targets.map((target) => target.kind),
    [
      "thought_evolution",
      "drive_evolution",
      "topic_lifecycle",
    ],
  );

  assert.equal(
    DEFAULT_BACKGROUND_TARGET_PLANS.distillation.priority,
    "consolidation",
  );
  assert.equal(
    DEFAULT_BACKGROUND_TARGET_PLANS.proactivityWake.priority,
    "reflection",
  );
  assert.equal(
    DEFAULT_BACKGROUND_TARGET_PLANS.topicResurface.priority,
    "reflection",
  );
});

test("Decay is opt-in and Breath is not a schedulable Companion target", () => {
  const disabled = new BackgroundOpportunityPolicy({
    decayEnabled: false,
  });
  const enabled = new BackgroundOpportunityPolicy({
    decayEnabled: true,
  });

  const disabledKinds =
    disabled.decide().targets.map((target) => target.kind);
  const enabledKinds =
    enabled.decide().targets.map((target) => target.kind);

  assert.equal(disabledKinds.includes("decay"), false);
  assert.equal(enabledKinds.includes("decay"), true);
  assert.equal(
    enabledKinds.includes("breath" as never),
    false,
  );
  assert.equal(
    enabledKinds.includes("distillation"),
    false,
  );
  assert.equal(
    enabledKinds.includes("proactivity_wake"),
    false,
  );
  assert.equal(
    enabledKinds.includes("topic_resurface"),
    false,
  );
});
