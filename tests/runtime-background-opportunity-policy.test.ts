import assert from "node:assert/strict";
import test from "node:test";
import {
  BackgroundOpportunityPolicy,
} from "../src/domains/runtime/background-opportunity-policy.js";

test("background opportunity policy keeps post-turn work separate from Companion due work", () => {
  const policy = new BackgroundOpportunityPolicy({
    decayEnabled: false,
    proactivityWakeEnabled: false,
    topicResurfaceEnabled: true,
  });

  assert.deepEqual(
    policy.decide({ opportunity: "post_turn" }).targets.map(
      (target) => target.kind,
    ),
    ["distillation"],
  );
  assert.deepEqual(
    policy.decide({ opportunity: "companion_due" }).targets.map(
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
});

test("Decay is opt-in and Breath is not a schedulable background target", () => {
  const policy = new BackgroundOpportunityPolicy({
    decayEnabled: true,
    proactivityWakeEnabled: false,
    topicResurfaceEnabled: false,
  });

  const kinds = [
    ...policy.decide({ opportunity: "post_turn" }).targets,
    ...policy.decide({ opportunity: "companion_due" }).targets,
    ...policy.decide({ opportunity: "mac_idle" }).targets,
  ].map((target) => target.kind);

  assert.equal(kinds.includes("decay"), true);
  assert.equal(kinds.includes("breath" as never), false);
  assert.equal(kinds.includes("topic_resurface"), false);
});

test("Proactivity wake is Companion due work, not a second scheduler", () => {
  const policy = new BackgroundOpportunityPolicy({
    decayEnabled: false,
    proactivityWakeEnabled: true,
    topicResurfaceEnabled: false,
  });

  assert.deepEqual(
    policy.decide({ opportunity: "companion_due" }).targets.map(
      (target) => target.kind,
    ),
    [
      "thought_evolution",
      "drive_evolution",
      "topic_lifecycle",
      "proactivity_wake",
    ],
  );
  assert.equal(
    policy.plan("companion_due", "proactivity_wake")?.priority,
    "reflection",
  );
});
