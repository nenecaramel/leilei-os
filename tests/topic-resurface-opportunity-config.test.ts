import assert from "node:assert/strict";
import test from "node:test";
import {
  getBackgroundMaintenancePulseConfig,
  getMemoryDecayConfig,
  getTopicResurfaceOpportunityConfig,
} from "../src/config/env.js";

test("Topic resurface opportunity config is disabled unless both explicit knobs are set", () => {
  assert.equal(
    getTopicResurfaceOpportunityConfig({
      NATIVE_LIVE_TOPIC_RESURFACE_MIN_INTERVAL_SECONDS: undefined,
      NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT: undefined,
    }),
    undefined,
  );

  assert.throws(
    () => getTopicResurfaceOpportunityConfig({
      NATIVE_LIVE_TOPIC_RESURFACE_MIN_INTERVAL_SECONDS: 60,
      NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT: undefined,
    }),
    /must be configured together/,
  );
});

test("Topic resurface opportunity config converts explicit seconds to milliseconds", () => {
  assert.deepEqual(
    getTopicResurfaceOpportunityConfig({
      NATIVE_LIVE_TOPIC_RESURFACE_MIN_INTERVAL_SECONDS: 90,
      NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT: 7,
    }),
    {
      minIntervalMs: 90_000,
      candidateLimit: 7,
    },
  );
});


test("background maintenance pulse uses one coarse default cadence with explicit overrides", () => {
  assert.deepEqual(
    getBackgroundMaintenancePulseConfig({
      NATIVE_LIVE_BACKGROUND_MAINTENANCE_PULSE_SECONDS: undefined,
      NATIVE_LIVE_BACKGROUND_MAINTENANCE_USER_LIMIT: undefined,
    }),
    {
      intervalMs: 3_600_000,
      userLimit: 64,
    },
  );

  assert.deepEqual(
    getBackgroundMaintenancePulseConfig({
      NATIVE_LIVE_BACKGROUND_MAINTENANCE_PULSE_SECONDS: 900,
      NATIVE_LIVE_BACKGROUND_MAINTENANCE_USER_LIMIT: 12,
    }),
    {
      intervalMs: 900_000,
      userLimit: 12,
    },
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
