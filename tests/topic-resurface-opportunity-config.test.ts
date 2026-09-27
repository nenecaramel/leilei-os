import assert from "node:assert/strict";
import test from "node:test";
import {
  getBreathRankingConfig,
  getMemoryDecayConfig,
  getMindSemanticGroupingConfig,
  getProactivityWakeOpportunityConfig,
  getTopicResurfaceOpportunityConfig,
} from "../src/config/env.js";

test("Topic resurface config is explicitly enabled while Companion owns cadence", () => {
  assert.equal(
    getTopicResurfaceOpportunityConfig({
      NATIVE_LIVE_TOPIC_RESURFACE_ENABLED: undefined,
      NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT: undefined,
    }),
    undefined,
  );

  assert.deepEqual(
    getTopicResurfaceOpportunityConfig({
      NATIVE_LIVE_TOPIC_RESURFACE_ENABLED: true,
      NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT: undefined,
    }),
    { candidateLimit: 5 },
  );

  assert.deepEqual(
    getTopicResurfaceOpportunityConfig({
      NATIVE_LIVE_TOPIC_RESURFACE_ENABLED: true,
      NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT: 7,
    }),
    { candidateLimit: 7 },
  );

  assert.throws(
    () => getTopicResurfaceOpportunityConfig({
      NATIVE_LIVE_TOPIC_RESURFACE_ENABLED: undefined,
      NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT: 7,
    }),
    /requires NATIVE_LIVE_TOPIC_RESURFACE_ENABLED=true/,
  );
});


test("Memory Decay stays disabled unless every semantic policy knob is explicit", () => {
  assert.equal(
    getMemoryDecayConfig({
      NATIVE_LIVE_MEMORY_DECAY_MEMORY_HALF_LIFE_HOURS: undefined,
      NATIVE_LIVE_MEMORY_DECAY_FEEL_HALF_LIFE_HOURS: undefined,
      NATIVE_LIVE_MEMORY_DECAY_FADING_THRESHOLD: undefined,
      NATIVE_LIVE_MEMORY_DECAY_ARCHIVE_THRESHOLD: undefined,
    }),
    undefined,
  );

  assert.throws(
    () => getMemoryDecayConfig({
      NATIVE_LIVE_MEMORY_DECAY_MEMORY_HALF_LIFE_HOURS: 720,
      NATIVE_LIVE_MEMORY_DECAY_FEEL_HALF_LIFE_HOURS: undefined,
      NATIVE_LIVE_MEMORY_DECAY_FADING_THRESHOLD: undefined,
      NATIVE_LIVE_MEMORY_DECAY_ARCHIVE_THRESHOLD: undefined,
    }),
    /must be configured together/,
  );

  assert.deepEqual(
    getMemoryDecayConfig({
      NATIVE_LIVE_MEMORY_DECAY_MEMORY_HALF_LIFE_HOURS: 720,
      NATIVE_LIVE_MEMORY_DECAY_FEEL_HALF_LIFE_HOURS: 168,
      NATIVE_LIVE_MEMORY_DECAY_FADING_THRESHOLD: 0.35,
      NATIVE_LIVE_MEMORY_DECAY_ARCHIVE_THRESHOLD: 0.1,
    }),
    {
      halfLifeHours: {
        memory: 720,
        feel: 168,
      },
      fadingThreshold: 0.35,
      archiveThreshold: 0.1,
    },
  );

  assert.throws(
    () => getMemoryDecayConfig({
      NATIVE_LIVE_MEMORY_DECAY_MEMORY_HALF_LIFE_HOURS: 720,
      NATIVE_LIVE_MEMORY_DECAY_FEEL_HALF_LIFE_HOURS: 168,
      NATIVE_LIVE_MEMORY_DECAY_FADING_THRESHOLD: 0.1,
      NATIVE_LIVE_MEMORY_DECAY_ARCHIVE_THRESHOLD: 0.1,
    }),
    /archive < fading/,
  );
});


test("Proactivity wake production opportunity is disabled by default and requires explicit policy", () => {
  assert.equal(
    getProactivityWakeOpportunityConfig({
      NATIVE_LIVE_PROACTIVITY_ENABLED: undefined,
      NATIVE_LIVE_PROACTIVITY_MIN_IDLE_SECONDS: undefined,
      NATIVE_LIVE_PROACTIVITY_COOLDOWN_SECONDS: undefined,
    }),
    undefined,
  );

  assert.throws(
    () => getProactivityWakeOpportunityConfig({
      NATIVE_LIVE_PROACTIVITY_ENABLED: undefined,
      NATIVE_LIVE_PROACTIVITY_MIN_IDLE_SECONDS: 7_200,
      NATIVE_LIVE_PROACTIVITY_COOLDOWN_SECONDS: undefined,
    }),
    /PROACTIVITY_ENABLED=true/,
  );

  assert.throws(
    () => getProactivityWakeOpportunityConfig({
      NATIVE_LIVE_PROACTIVITY_ENABLED: true,
      NATIVE_LIVE_PROACTIVITY_MIN_IDLE_SECONDS: 7_200,
      NATIVE_LIVE_PROACTIVITY_COOLDOWN_SECONDS: undefined,
    }),
    /are required when Proactivity is enabled/,
  );

  assert.deepEqual(
    getProactivityWakeOpportunityConfig({
      NATIVE_LIVE_PROACTIVITY_ENABLED: true,
      NATIVE_LIVE_PROACTIVITY_MIN_IDLE_SECONDS: 7_200,
      NATIVE_LIVE_PROACTIVITY_COOLDOWN_SECONDS: 21_600,
    }),
    {
      minIdleMs: 7_200_000,
      cooldownMs: 21_600_000,
    },
  );
});


test("Breath salience ranking has a conservative production default and stays explicitly tunable", () => {
  assert.deepEqual(
    getBreathRankingConfig({
      NATIVE_LIVE_BREATH_SALIENCE_WEIGHT: undefined,
    }),
    { salienceWeight: 0.1 },
  );

  assert.deepEqual(
    getBreathRankingConfig({
      NATIVE_LIVE_BREATH_SALIENCE_WEIGHT: 0.2,
    }),
    { salienceWeight: 0.2 },
  );

  assert.throws(
    () => getBreathRankingConfig({
      NATIVE_LIVE_BREATH_SALIENCE_WEIGHT: 1.1,
    } as never),
    /between 0 and 1/,
  );
});


test("Mind semantic grouping is fail-closed until an explicit merge threshold is configured", () => {
  assert.equal(
    getMindSemanticGroupingConfig({
      NATIVE_LIVE_MIND_SEMANTIC_GROUPING_THRESHOLD: undefined,
    }),
    undefined,
  );

  assert.deepEqual(
    getMindSemanticGroupingConfig({
      NATIVE_LIVE_MIND_SEMANTIC_GROUPING_THRESHOLD: 0.88,
    }),
    {
      threshold: 0.88,
      candidateLimit: 32,
    },
  );

  assert.throws(
    () => getMindSemanticGroupingConfig({
      NATIVE_LIVE_MIND_SEMANTIC_GROUPING_THRESHOLD: 0,
    }),
    /greater than 0 and at most 1/,
  );
});
